-- Chat: functions the dashboard calls (authenticated only). Every function
-- checks the session (PT401), the second factor when the user has one (aal2),
-- real organization membership (PT403 / PT404 without revealing whether a
-- conversation exists), validates input (22023) and rate-limits writes (PT429).

-- Caller id, or PT401. Also the aal2 rule of the dashboard.
create or replace function private.chat_assert_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  perform private.assert_mfa();
  return v_uid;
end;
$$;

-- Display name of an account: profile name, else the part of the e-mail before @.
create or replace function private.chat_display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1))
  from public.profiles p
  where p.id = p_user;
$$;

-- j***@e***.com for viewers (visitor contact details).
create or replace function private.chat_mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then null
    else left(split_part(p_email, '@', 1), 1) || '***@'
      || left(split_part(p_email, '@', 2), 1) || '***'
      || coalesce('.' || nullif(regexp_replace(split_part(p_email, '@', 2), '^.*\.', ''), split_part(p_email, '@', 2)), '')
  end;
$$;

-- Messages as JSON (oldest first), decrypted with p_key. Deleted messages keep
-- their place without text. The caller has already checked access.
create or replace function private.chat_messages_json(p_ids uuid[], p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id,
      'conversation_id', m.conversation_id,
      'kind', m.kind,
      'sender_id', m.sender_user_id,
      'sender_name', coalesce(m.sender_label, private.chat_display_name(m.sender_user_id)),
      'sender_avatar', sp.avatar_url,
      'body', case when m.deleted_at is null then private.chat_decrypt(m.body_ciphertext, p_key) end,
      'created_at', m.created_at,
      'edited_at', m.edited_at,
      'deleted_at', m.deleted_at,
      'client_id', case when m.sender_user_id = (select auth.uid()) then m.client_id end,
      'mine', coalesce(m.sender_user_id = (select auth.uid()), false),
      'reply_to', case when r.id is not null then jsonb_build_object(
        'id', r.id,
        'sender_name', coalesce(r.sender_label, private.chat_display_name(r.sender_user_id)),
        'body', case when r.deleted_at is null then left(private.chat_decrypt(r.body_ciphertext, p_key), 200) end,
        'deleted', r.deleted_at is not null
      ) end
    ) order by m.created_at, m.id), '[]'::jsonb)
  from public.chat_messages m
  left join public.profiles sp on sp.id = m.sender_user_id
  left join public.chat_messages r on r.id = m.reply_to and r.conversation_id = m.conversation_id
  where m.id = any (p_ids);
$$;

-- Unread messages of the caller in one conversation (capped at 100): messages
-- of others after the last read time. Team rows start at the join date.
create or replace function private.chat_unread(p_conversation uuid, p_uid uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from (
    select 1
    from public.chat_messages m
    join public.chat_conversations c on c.id = m.conversation_id
    left join public.chat_participants p on p.conversation_id = c.id and p.user_id = p_uid
    left join public.organization_members om on om.organization_id = c.organization_id and om.user_id = p_uid
    where m.conversation_id = p_conversation
      and m.deleted_at is null
      and m.sender_user_id is distinct from p_uid
      and m.created_at > coalesce(
        p.last_read_at,
        case when c.kind = 'team' then om.created_at end,
        '-infinity'::timestamptz)
    limit 100
  ) x;
$$;

revoke all on function private.chat_assert_user() from public, anon, authenticated;
revoke all on function private.chat_display_name(uuid) from public, anon, authenticated;
revoke all on function private.chat_mask_email(text) from public, anon, authenticated;
revoke all on function private.chat_messages_json(uuid[], text) from public, anon, authenticated;
revoke all on function private.chat_unread(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- reads

-- Conversations of the caller in one organization: the team channel (created
-- here when missing), direct conversations, visitor conversations (latest 200).
create or replace function public.chat_list_conversations(p_org uuid, p_include_archived boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
  v_role text := private.chat_role(p_org);
  v_key text;
  v_result jsonb;
begin
  if v_role is null then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;

  insert into public.chat_conversations (organization_id, kind, created_by)
  values (p_org, 'team', v_uid)
  on conflict (organization_id) where kind = 'team' do nothing;

  v_key := private.chat_key(1);

  select coalesce(jsonb_agg(row_json order by sort_team, last_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      case when c.kind = 'team' then 0 else 1 end as sort_team,
      c.last_message_at as last_at,
      jsonb_build_object(
        'id', c.id,
        'kind', c.kind,
        'title', c.title,
        'created_at', c.created_at,
        'last_message_at', c.last_message_at,
        'resolved_at', c.resolved_at,
        'archived_at', c.archived_at,
        'muted', coalesce(p.muted, false),
        'unread', private.chat_unread(c.id, v_uid),
        'member_count', case when c.kind = 'team' then
          (select count(*) from public.organization_members om where om.organization_id = c.organization_id) end,
        'last_message', (
          select jsonb_build_object(
            'kind', lm.kind,
            'sender_name', coalesce(lm.sender_label, private.chat_display_name(lm.sender_user_id)),
            'mine', coalesce(lm.sender_user_id = v_uid, false),
            'body', case when lm.deleted_at is null then left(private.chat_decrypt(lm.body_ciphertext, v_key), 140) end,
            'created_at', lm.created_at,
            'deleted', lm.deleted_at is not null
          )
          from public.chat_messages lm
          where lm.conversation_id = c.id
          order by lm.created_at desc, lm.id desc
          limit 1
        ),
        'peer', case when c.kind = 'direct' then (
          select jsonb_build_object(
            'id', op.user_id,
            'name', private.chat_display_name(op.user_id),
            'avatar', pr.avatar_url,
            'is_member', exists (
              select 1 from public.organization_members om
              where om.organization_id = c.organization_id and om.user_id = op.user_id)
          )
          from public.chat_participants op
          left join public.profiles pr on pr.id = op.user_id
          where op.conversation_id = c.id and op.user_id <> v_uid
          limit 1
        ) end,
        'visitor', case when c.kind = 'visitor' then (
          select jsonb_build_object(
            'name', v.name,
            'email', case when private.role_rank(v_role) >= private.role_rank('editor')
              then v.email else private.chat_mask_email(v.email) end,
            'has_email', v.email is not null,
            'website_name', w.name,
            'source', case when c.source_submission_id is not null then 'form' else 'widget' end
          )
          from public.chat_visitors v
          join public.websites w on w.id = v.website_id
          where v.conversation_id = c.id
        ) end
      ) as row_json
    from public.chat_conversations c
    left join public.chat_participants p on p.conversation_id = c.id and p.user_id = v_uid
    where c.organization_id = p_org
      and (
        c.kind = 'team'
        or (c.kind = 'direct' and p.user_id is not null)
        or (c.kind = 'visitor' and c.id in (
          select vc.id from public.chat_conversations vc
          where vc.organization_id = p_org and vc.kind = 'visitor'
            and (p_include_archived or vc.archived_at is null)
          order by vc.last_message_at desc
          limit 200))
      )
  ) r;

  return v_result;
end;
$$;

-- One page of messages, oldest first. Without cursor: the latest p_limit.
-- p_before / p_before_id: older page. p_after: messages newer than this time
-- (Realtime catch-up).
create or replace function public.chat_list_messages(
  p_conversation uuid,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_after timestamptz default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_ids uuid[];
begin
  if p_conversation is null or not private.chat_can_read(p_conversation) then
    raise exception 'not found' using errcode = 'PT404';
  end if;

  if p_after is not null then
    select array_agg(id) into v_ids from (
      select m.id from public.chat_messages m
      where m.conversation_id = p_conversation and m.created_at > p_after
      order by m.created_at, m.id
      limit v_limit
    ) x;
  else
    select array_agg(id) into v_ids from (
      select m.id from public.chat_messages m
      where m.conversation_id = p_conversation
        and (p_before is null or (m.created_at, m.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by m.created_at desc, m.id desc
      limit v_limit
    ) x;
  end if;

  if v_ids is null then
    return '[]'::jsonb;
  end if;
  return private.chat_messages_json(v_ids, private.chat_key(1));
end;
$$;

-- One message (Realtime update: edited or deleted).
create or replace function public.chat_get_message(p_message uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
  v_conversation uuid;
begin
  select conversation_id into v_conversation from public.chat_messages where id = p_message;
  if v_conversation is null or not private.chat_can_read(v_conversation) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  return private.chat_messages_json(array[p_message], private.chat_key(1)) -> 0;
end;
$$;

-- Members the caller can start a direct conversation with.
create or replace function public.chat_list_members(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
begin
  if private.chat_role(p_org) is null then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.user_id,
        'name', private.chat_display_name(m.user_id),
        'avatar', p.avatar_url,
        'role', m.role
      ) order by lower(private.chat_display_name(m.user_id))), '[]'::jsonb)
    from public.organization_members m
    left join public.profiles p on p.id = m.user_id
    where m.organization_id = p_org and m.user_id <> v_uid
  );
end;
$$;

-- Total unread for the sidebar badge (muted conversations excluded, capped at 999).
create or replace function public.chat_unread_total(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
begin
  if private.chat_role(p_org) is null then
    return 0;
  end if;
  return least(coalesce((
    select sum(private.chat_unread(c.id, v_uid))
    from public.chat_conversations c
    left join public.chat_participants p on p.conversation_id = c.id and p.user_id = v_uid
    where c.organization_id = p_org
      and c.archived_at is null
      and coalesce(p.muted, false) = false
      and (c.kind in ('team', 'visitor') or p.user_id is not null)
      and c.last_message_at > now() - interval '90 days'
  ), 0), 999)::integer;
end;
$$;

-- ---------------------------------------------------------------- writes

-- Sends a message. Team / direct: any member (direct: both still members).
-- Visitor conversations: editors and above, stored as an internal note.
-- p_client_id makes a retry idempotent (same id: same message back).
-- At most 30 messages per minute per account.
create or replace function public.chat_send_message(
  p_conversation uuid,
  p_body text,
  p_reply_to uuid default null,
  p_client_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
  v_conv public.chat_conversations%rowtype;
  v_role text;
  v_kind text := 'message';
  v_body text;
  v_id uuid;
  v_count integer;
begin
  select * into v_conv from public.chat_conversations where id = p_conversation;
  if not found or not private.chat_can_read(p_conversation) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  v_role := private.chat_role(v_conv.organization_id);

  if v_conv.kind = 'visitor' then
    if private.role_rank(v_role) < private.role_rank('editor') then
      raise exception 'forbidden' using errcode = 'PT403';
    end if;
    v_kind := 'note';
  elsif v_conv.kind = 'direct' and exists (
    select 1 from public.chat_participants p
    where p.conversation_id = v_conv.id and p.user_id <> v_uid
      and not exists (
        select 1 from public.organization_members om
        where om.organization_id = v_conv.organization_id and om.user_id = p.user_id)
  ) then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;

  v_body := private.check_text(p_body, 4000, 'message', true);
  if v_body is null then
    raise exception 'Empty message' using errcode = '22023';
  end if;

  -- One sender at a time: exact rate limit and idempotent retries.
  perform pg_advisory_xact_lock(hashtextextended('chat_send:' || v_uid::text, 0));

  if p_client_id is not null then
    select id into v_id from public.chat_messages where sender_user_id = v_uid and client_id = p_client_id;
    if v_id is not null then
      return private.chat_messages_json(array[v_id], private.chat_key(1)) -> 0;
    end if;
  end if;

  select count(*) into v_count
  from public.chat_messages
  where sender_user_id = v_uid and created_at > now() - interval '1 minute';
  if v_count >= 30 then
    raise exception 'rate limited' using errcode = 'PT429';
  end if;

  if p_reply_to is not null and not exists (
    select 1 from public.chat_messages where id = p_reply_to and conversation_id = v_conv.id
  ) then
    raise exception 'Invalid reply' using errcode = '22023';
  end if;

  insert into public.chat_messages (
    conversation_id, organization_id, kind, sender_user_id, body_ciphertext, body_key, reply_to, client_id
  ) values (
    v_conv.id, v_conv.organization_id, v_kind, v_uid,
    private.chat_encrypt(v_body, private.chat_key(1)), 1, p_reply_to, p_client_id
  ) returning id into v_id;

  update public.chat_conversations set last_message_at = now() where id = v_conv.id;

  insert into public.chat_participants (conversation_id, user_id, role, last_read_at)
  values (v_conv.id, v_uid, case when v_conv.kind = 'visitor' then 'staff' else 'member' end, now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();

  return private.chat_messages_json(array[v_id], private.chat_key(1)) -> 0;
end;
$$;

-- Edits one of your own messages (not deleted, not a visitor message).
-- At most 60 edits per minute per account.
create or replace function public.chat_edit_message(p_message uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
  v_msg public.chat_messages%rowtype;
  v_body text;
begin
  select * into v_msg from public.chat_messages where id = p_message;
  if not found or not private.chat_can_read(v_msg.conversation_id) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  if v_msg.sender_user_id is distinct from v_uid or v_msg.deleted_at is not null then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  v_body := private.check_text(p_body, 4000, 'message', true);
  if v_body is null then
    raise exception 'Empty message' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('chat_edit', v_uid::text, 60, interval '1 minute');

  update public.chat_messages
  set body_ciphertext = private.chat_encrypt(v_body, private.chat_key(1)), body_key = 1, edited_at = now()
  where id = p_message;

  return private.chat_messages_json(array[p_message], private.chat_key(1)) -> 0;
end;
$$;

-- Soft-deletes one of your own messages: the encrypted body is wiped, the row
-- stays so the thread and replies keep their place.
create or replace function public.chat_delete_message(p_message uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
  v_msg public.chat_messages%rowtype;
begin
  select * into v_msg from public.chat_messages where id = p_message;
  if not found or not private.chat_can_read(v_msg.conversation_id) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  if v_msg.sender_user_id is distinct from v_uid then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  if v_msg.deleted_at is null then
    update public.chat_messages set deleted_at = now(), body_ciphertext = null where id = p_message;
  end if;
  return private.chat_messages_json(array[p_message], private.chat_key(1)) -> 0;
end;
$$;

create or replace function public.chat_mark_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
  v_kind text;
begin
  if p_conversation is null or not private.chat_can_read(p_conversation) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  select kind into v_kind from public.chat_conversations where id = p_conversation;
  insert into public.chat_participants (conversation_id, user_id, role, last_read_at)
  values (p_conversation, v_uid, case when v_kind = 'visitor' then 'staff' else 'member' end, now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();
end;
$$;

create or replace function public.chat_set_muted(p_conversation uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
  v_kind text;
begin
  if p_conversation is null or p_muted is null or not private.chat_can_read(p_conversation) then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  select kind into v_kind from public.chat_conversations where id = p_conversation;
  insert into public.chat_participants (conversation_id, user_id, role, muted)
  values (p_conversation, v_uid, case when v_kind = 'visitor' then 'staff' else 'member' end, p_muted)
  on conflict (conversation_id, user_id) do update set muted = excluded.muted;
end;
$$;

-- Opens (or creates) the direct conversation with another member of the same
-- organization. New conversations: at most 30 per hour per account.
create or replace function public.chat_open_direct(p_org uuid, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.chat_assert_user();
  v_key text;
  v_id uuid;
begin
  if private.chat_role(p_org) is null then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  if p_user is null or p_user = v_uid or not exists (
    select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = p_user
  ) then
    raise exception 'Invalid member' using errcode = '22023';
  end if;

  v_key := least(v_uid, p_user)::text || ':' || greatest(v_uid, p_user)::text;
  select id into v_id from public.chat_conversations
  where organization_id = p_org and kind = 'direct' and direct_key = v_key;

  if v_id is null then
    perform private.hit_rate_limit('chat_direct', v_uid::text, 30, interval '1 hour');
    insert into public.chat_conversations (organization_id, kind, direct_key, created_by)
    values (p_org, 'direct', v_key, v_uid)
    on conflict (organization_id, direct_key) where kind = 'direct' do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.chat_conversations
      where organization_id = p_org and kind = 'direct' and direct_key = v_key;
    end if;
  end if;

  insert into public.chat_participants (conversation_id, user_id, role)
  values (v_id, v_uid, 'member'), (v_id, p_user, 'member')
  on conflict (conversation_id, user_id) do nothing;

  return v_id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.chat_list_conversations(uuid, boolean)',
    'public.chat_list_messages(uuid, timestamptz, uuid, timestamptz, integer)',
    'public.chat_get_message(uuid)',
    'public.chat_list_members(uuid)',
    'public.chat_unread_total(uuid)',
    'public.chat_send_message(uuid, text, uuid, uuid)',
    'public.chat_edit_message(uuid, text)',
    'public.chat_delete_message(uuid)',
    'public.chat_mark_read(uuid)',
    'public.chat_set_muted(uuid, boolean)',
    'public.chat_open_direct(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
