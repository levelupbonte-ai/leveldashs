-- Chat: messages people send to the business from the website ("visitors").
--
--   * contact form submissions (submit_form, form_type contact) with a message
--     become a visitor conversation, through a trigger on form_submissions;
--   * public.send_site_message(): optional public RPC for a future chat widget
--     (feature site_chat, off by default): same rules as submit_form (live
--     website, allowed origins, validation, rate limits) plus a honeypot field.
--
-- A new message from the same e-mail address joins the open (not resolved, not
-- archived) conversation of that website; otherwise a new one starts. Visitor
-- identity is never verified: the dashboard says so next to the contact.

create or replace function private.chat_ingest_visitor(
  p_website_id text,
  p_name text,
  p_email text,
  p_phone text,
  p_body text,
  p_submission uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_conv uuid;
  v_label text := coalesce(p_name, p_email, p_phone, 'Visitor');
begin
  select organization_id into v_org from public.websites where id = p_website_id;
  if v_org is null or p_body is null then
    return null;
  end if;

  if p_email is not null then
    select c.id into v_conv
    from public.chat_conversations c
    join public.chat_visitors v on v.conversation_id = c.id
    where c.website_id = p_website_id
      and c.kind = 'visitor'
      and c.resolved_at is null
      and c.archived_at is null
      and lower(v.email) = lower(p_email)
    order by c.last_message_at desc
    limit 1;
  end if;

  if v_conv is null then
    insert into public.chat_conversations (organization_id, website_id, kind, title, source_submission_id)
    values (v_org, p_website_id, 'visitor', left(v_label, 120), p_submission)
    returning id into v_conv;
    insert into public.chat_visitors (conversation_id, organization_id, website_id, name, email, phone)
    values (v_conv, v_org, p_website_id, left(p_name, 120), left(lower(p_email), 254), left(p_phone, 40));
  else
    update public.chat_visitors
    set name = coalesce(left(p_name, 120), name), phone = coalesce(left(p_phone, 40), phone)
    where conversation_id = v_conv;
  end if;

  insert into public.chat_messages (conversation_id, organization_id, kind, sender_label, body_ciphertext, body_key)
  values (v_conv, v_org, 'visitor', left(v_label, 120), private.chat_encrypt(left(p_body, 5000), private.chat_key(1)), 1);

  update public.chat_conversations set last_message_at = now() where id = v_conv;
  return v_conv;
end;
$$;

revoke all on function private.chat_ingest_visitor(text, text, text, text, text, uuid) from public, anon, authenticated;

-- Contact form messages also reach the chat inbox. Never blocks the form: a
-- failure here only leaves a warning in the database log.
create or replace function private.chat_from_form_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.form_type = 'contact' and new.message is not null and btrim(new.message) <> '' then
    begin
      perform private.chat_ingest_visitor(new.website_id, new.name, new.email, new.phone, new.message, new.id);
    exception when others then
      raise warning 'chat: contact form message not copied (%)', sqlstate;
    end;
  end if;
  return null;
end;
$$;

revoke all on function private.chat_from_form_submission() from public, anon, authenticated;

create trigger form_submissions_to_chat
  after insert on public.form_submissions
  for each row execute function private.chat_from_form_submission();

-- Public: a visitor sends a message to the business (future chat widget).
-- p_hp is a honeypot: when a bot fills it, the answer is the same and nothing
-- is stored. Limits: 20 messages per hour per e-mail, 300 per hour per website.
create or replace function public.send_site_message(
  p_website_id text,
  p_name text,
  p_email text,
  p_message text,
  p_hp text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_email text;
  v_message text;
  v_count integer;
begin
  if p_website_id is null or p_website_id !~ '^ws_[a-z0-9]{8,32}$' or not private.is_website_live(p_website_id) then
    raise exception 'Website not found' using errcode = 'PT404';
  end if;
  if not private.website_has_feature(p_website_id, 'site_chat') then
    raise exception 'This form is not available' using errcode = 'PT403';
  end if;
  perform private.assert_origin_allowed(p_website_id);

  if p_hp is not null and btrim(p_hp) <> '' then
    return jsonb_build_object('ok', true);
  end if;

  v_name := private.check_text(p_name, 120, 'name');
  v_email := lower(private.check_text(p_email, 254, 'email'));
  v_message := private.check_text(p_message, 4000, 'message', true);
  if v_email is null or not private.is_valid_email(v_email) then
    raise exception 'Invalid email address' using errcode = '22023';
  end if;
  if v_message is null then
    raise exception 'A message is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('chat_site:' || p_website_id, 0));

  select count(*) into v_count
  from public.chat_messages m
  join public.chat_conversations c on c.id = m.conversation_id
  where c.website_id = p_website_id and m.kind = 'visitor' and m.created_at > now() - interval '1 hour';
  if v_count >= 300 then
    raise exception 'Too many requests, please try again later' using errcode = 'PT429';
  end if;

  select count(*) into v_count
  from public.chat_messages m
  join public.chat_visitors v on v.conversation_id = m.conversation_id
  where v.website_id = p_website_id and lower(v.email) = v_email
    and m.kind = 'visitor' and m.created_at > now() - interval '1 hour';
  if v_count >= 20 then
    raise exception 'Too many requests, please try again later' using errcode = 'PT429';
  end if;

  perform private.chat_ingest_visitor(p_website_id, v_name, v_email, null, v_message, null);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.send_site_message(text, text, text, text, text) from public;
grant execute on function public.send_site_message(text, text, text, text, text) to anon, authenticated;

-- Staff: open / resolved / archived (editors and above).
create or replace function public.chat_set_visitor_status(p_conversation uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
  v_org uuid;
begin
  select organization_id into v_org from public.chat_conversations
  where id = p_conversation and kind = 'visitor';
  if v_org is null or not private.chat_can_read(p_conversation) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  if private.role_rank(private.chat_role(v_org)) < private.role_rank('editor') then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  if p_status not in ('open', 'resolved', 'archived') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  update public.chat_conversations
  set resolved_at = case when p_status = 'open' then null when p_status = 'resolved' then coalesce(resolved_at, now()) else resolved_at end,
      archived_at = case when p_status = 'archived' then coalesce(archived_at, now()) else null end
  where id = p_conversation;
end;
$$;

-- Staff: full contact details for "Reply by email" (editors and above only;
-- viewers get a masked address in the conversation list).
create or replace function public.chat_visitor_contact(p_conversation uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
  v_org uuid;
begin
  select organization_id into v_org from public.chat_conversations
  where id = p_conversation and kind = 'visitor';
  if v_org is null or not private.chat_can_read(p_conversation) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  if private.role_rank(private.chat_role(v_org)) < private.role_rank('editor') then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  return (
    select jsonb_build_object('name', v.name, 'email', v.email, 'phone', v.phone,
      'website_name', w.name, 'website_domain', w.primary_domain)
    from public.chat_visitors v
    join public.websites w on w.id = v.website_id
    where v.conversation_id = p_conversation
  );
end;
$$;

revoke all on function public.chat_set_visitor_status(uuid, text) from public, anon;
revoke all on function public.chat_visitor_contact(uuid) from public, anon;
grant execute on function public.chat_set_visitor_status(uuid, text) to authenticated;
grant execute on function public.chat_visitor_contact(uuid) to authenticated;
