-- Consumption shown on the Billing page: this period's real counts only (never
-- costs, never providers). Members of the organization (viewer and up).
--
-- private.org_storage(org): bytes and file count of the media library, the one
-- source for the `media_mb` meter and the usage panel.
-- HOOK: when public.org_storage_usage(p_org uuid) (storage bytes + file count,
-- media library work) lands, make private.org_storage return its numbers so the
-- meter, the panel and any upload check share them.
--
-- public.billing_usage(org) -> { period_start, storage_bytes, media_files,
--   chat_messages_month, assistant_requests_month, team_members, websites }
-- The period is the current UTC calendar month (same as the assistant allowance).

create or replace function private.org_storage(p_org uuid)
returns table (bytes bigint, files integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.size_bytes), 0)::bigint, count(*)::integer
  from public.media m
  where m.organization_id = p_org;
$$;

create or replace function private.org_usage(p_org uuid, p_key text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case p_key
    when 'team_members' then private.team_seats_used(p_org)::numeric
    when 'assistant_requests_month' then (
      select coalesce(sum(u.count), 0)::numeric from public.ai_usage u
      where u.organization_id = p_org and u.feature = 'assistant'
        and u.day >= date_trunc('month', now() at time zone 'utc')::date)
    when 'media_mb' then (select round(s.bytes / 1048576.0, 1) from private.org_storage(p_org) s)
    when 'websites' then (
      select count(*)::numeric from public.websites w
      where w.organization_id = p_org and w.status <> 'archived')
  end;
$$;

create or replace function public.billing_usage(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_storage record;
begin
  if auth.uid() is null or p_org is null or not private.has_org_role(p_org, 'viewer') then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  select * into v_storage from private.org_storage(p_org);
  return jsonb_build_object(
    'period_start', v_start,
    'storage_bytes', v_storage.bytes,
    'media_files', v_storage.files,
    'chat_messages_month', (
      select count(*) from public.chat_messages c
      where c.organization_id = p_org and c.created_at >= v_start and c.deleted_at is null),
    'assistant_requests_month', private.org_usage(p_org, 'assistant_requests_month')::integer,
    'team_members', (select count(*) from public.organization_members m where m.organization_id = p_org),
    'pending_invitations', private.team_seats_used(p_org)
      - (select count(*) from public.organization_members m where m.organization_id = p_org),
    'websites', private.org_usage(p_org, 'websites')::integer);
end;
$$;

revoke all on function private.org_storage(uuid) from public, anon, authenticated;
revoke all on function private.org_usage(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_usage(uuid) from public, anon;
grant execute on function public.billing_usage(uuid) to authenticated;
