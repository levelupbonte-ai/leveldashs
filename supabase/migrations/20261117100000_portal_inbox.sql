-- Client portal inbox for the team (first: Black Pater). One conversation per
-- member, in folders: unread, read, drafts, archived; and one message sent to
-- several members at once (grouped by destination, project or missing dossier).
--
--   private.portal_inbox_state            per member: archived, the team's draft
--   portal_admin_inbox(website)           conversations with their last message
--   portal_admin_inbox_archive(customer, archived)
--   portal_admin_inbox_draft(customer, body)     body null / empty: no draft
--   portal_admin_reply_many(website, customers[], body)   same message to each
-- A team reply clears that member's draft; a new message from the member takes
-- the conversation out of the archive (like an e-mail inbox).

create table if not exists private.portal_inbox_state (
  customer_id uuid primary key references public.portal_customers (id) on delete cascade,
  archived_at timestamptz,
  draft text check (draft is null or char_length(draft) <= 4000),
  draft_updated_at timestamptz
);
revoke all on table private.portal_inbox_state from public, anon, authenticated;

create or replace function private.portal_inbox_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sender = 'owner' then
    update private.portal_inbox_state set draft = null, draft_updated_at = null where customer_id = new.customer_id;
  else
    update private.portal_inbox_state set archived_at = null where customer_id = new.customer_id;
  end if;
  return new;
end;
$$;
revoke all on function private.portal_inbox_on_message() from public, anon, authenticated;

drop trigger if exists portal_inbox_on_message on public.portal_messages;
create trigger portal_inbox_on_message after insert on public.portal_messages
  for each row execute function private.portal_inbox_on_message();

create or replace function public.portal_admin_inbox(p_website_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.portal_manage_site(p_website_id);
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.sort_at desc nulls last)
    from (
      select c.id, c.name, c.email, c.status, c.locale, c.member_until, c.trial_ends_at,
        upper(nullif(c.profile ->> 'destinationCountry', '')) as country,
        nullif(c.profile #>> '{answers,purpose}', '') as purpose,
        coalesce(c.profile ? 'destinationCountry', false) as has_dossier,
        (select count(*) from public.portal_messages m
          where m.customer_id = c.id and m.sender = 'customer' and m.read_at is null) as unread,
        (select count(*) from public.portal_messages m where m.customer_id = c.id) as messages,
        (select jsonb_build_object('body', left(m.body, 160), 'sender', m.sender, 'at', m.created_at)
          from public.portal_messages m where m.customer_id = c.id order by m.created_at desc limit 1) as last,
        s.archived_at is not null as archived,
        s.draft, s.draft_updated_at,
        greatest((select max(m.created_at) from public.portal_messages m where m.customer_id = c.id),
          s.draft_updated_at, c.created_at) as sort_at
      from public.portal_customers c
      left join private.portal_inbox_state s on s.customer_id = c.id
      where c.website_id = p_website_id and c.deleted_at is null
    ) x), '[]'::jsonb);
end;
$$;

create or replace function public.portal_admin_inbox_archive(p_customer_id uuid, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  select * into c from public.portal_customers where id = p_customer_id;
  if c.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.portal_manage_site(c.website_id);
  insert into private.portal_inbox_state (customer_id, archived_at)
  values (c.id, case when p_archived then now() end)
  on conflict (customer_id) do update set archived_at = case when p_archived then now() end;
  return jsonb_build_object('ok', true, 'archived', coalesce(p_archived, false));
end;
$$;

create or replace function public.portal_admin_inbox_draft(p_customer_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  select * into c from public.portal_customers where id = p_customer_id;
  if c.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.portal_manage_site(c.website_id);
  if v_body is not null and char_length(v_body) > 4000 then
    raise exception 'Message too long' using errcode = '22023';
  end if;
  insert into private.portal_inbox_state (customer_id, draft, draft_updated_at)
  values (c.id, v_body, case when v_body is not null then now() end)
  on conflict (customer_id) do update set draft = excluded.draft, draft_updated_at = excluded.draft_updated_at;
  return jsonb_build_object('ok', true, 'draft', v_body);
end;
$$;

create or replace function public.portal_admin_reply_many(p_website_id text, p_customer_ids uuid[], p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
  v_sent integer := 0;
begin
  v_org := private.portal_manage_site(p_website_id);
  if p_customer_ids is null or cardinality(p_customer_ids) = 0 or cardinality(p_customer_ids) > 200 then
    raise exception 'Choose between 1 and 200 members' using errcode = '22023';
  end if;
  for v_id in
    select c.id from public.portal_customers c
    where c.id = any (p_customer_ids) and c.website_id = p_website_id and c.deleted_at is null
  loop
    perform public.portal_admin_reply(v_id, p_body);
    v_sent := v_sent + 1;
  end loop;
  perform private.site_audit(p_website_id, v_org, 'portal.message_group', null,
    jsonb_build_object('count', v_sent));
  return jsonb_build_object('ok', true, 'sent', v_sent);
end;
$$;

revoke all on function public.portal_admin_inbox(text), public.portal_admin_inbox_archive(uuid, boolean),
  public.portal_admin_inbox_draft(uuid, text), public.portal_admin_reply_many(text, uuid[], text) from public, anon;
grant execute on function public.portal_admin_inbox(text), public.portal_admin_inbox_archive(uuid, boolean),
  public.portal_admin_inbox_draft(uuid, text), public.portal_admin_reply_many(text, uuid[], text) to authenticated;
