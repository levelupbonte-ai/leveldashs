-- Plan limits wired into the real actions (helpers in 20261026110100_billing_functions.sql).
-- Each raises `plan_limit_reached` (errcode PT402, detail {"key", "limit", "plan"}):
--   team_members              create_organization_invitation, add_organization_member
--                             (members + live invitations; a re-sent invitation keeps its seat)
--   assistant_requests_month  assistant_consume (dashboard AI assistant, UTC calendar month;
--                             the 60 per day safety cap stays)
-- `media_mb` and `websites` are shown as usage only for now: websites are created by
-- LevelUp, and the media upload path (Storage first, then the row) belongs to the
-- media library work. Hook to enforce media_mb later, before the upload:
--   private.assert_within_limit(org, 'media_mb', used_mb, file_mb)
-- with used_mb from private.org_storage(org) (20261026110300_billing_usage.sql).
-- Accepting an invitation never checks the limit (its seat was counted when it was sent).

-- @part 1: team invitations (same function as 20261024100200, plus the seat check) --

create or replace function public.create_organization_invitation(p_organization_id uuid, p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_inv uuid;
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'editor', 'viewer') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if not private.has_org_role(p_organization_id, case when p_role = 'owner' then 'owner' else 'admin' end) then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  perform private.assert_mfa();
  if not private.is_valid_email(v_email) then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.organization_members m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id and lower(u.email) = v_email
  ) then
    raise exception 'already_member' using errcode = 'PT409';
  end if;
  -- Plan limit: members + live invitations (this address excepted).
  perform private.assert_within_limit(p_organization_id, 'team_members',
    private.team_seats_used(p_organization_id, v_email));
  perform private.hit_rate_limit('org_invitations', p_organization_id::text, 20, interval '1 day');

  insert into public.organization_invitations (organization_id, email, role, invited_by, expires_at, email_status)
  values (p_organization_id, v_email, p_role, auth.uid(), now() + interval '7 days', 'pending')
  on conflict (organization_id, email) where accepted_at is null
  do update set role = excluded.role, invited_by = excluded.invited_by, expires_at = excluded.expires_at,
                revoked_at = null, revoked_by = null, email_status = 'pending'
  returning id into v_inv;

  v_token := private.new_url_token();
  insert into private.organization_invitation_tokens (invitation_id, token_hash, expires_at)
  values (v_inv, private.sha256_hex(v_token), now() + interval '7 days')
  on conflict (invitation_id) do update
    set token_hash = excluded.token_hash, created_at = now(), expires_at = excluded.expires_at, used_at = null;

  perform private.hq_log('team.invitation_created', 'organization', p_organization_id::text,
    jsonb_build_object('invitation_id', v_inv, 'email', v_email, 'role', p_role));
  return private.invitation_payload(v_inv, v_token);
end;
$$;

-- @part 2: add an existing account (same function, plus the seat check for a new member)

create or replace function public.add_organization_member(p_organization_id uuid, p_email text, p_role text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_role not in ('owner', 'admin', 'editor', 'viewer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  if not private.has_org_role(p_organization_id, case when p_role = 'owner' then 'owner' else 'admin' end) then
    raise exception 'Forbidden' using errcode = 'PT403';
  end if;
  perform private.assert_mfa();

  select m.role into v_existing
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_organization_id and lower(u.email) = lower(btrim(p_email));
  if v_existing = 'owner' and not private.has_org_role(p_organization_id, 'owner') then
    raise exception 'Forbidden' using errcode = 'PT403';
  end if;
  if v_existing is null then
    perform private.assert_within_limit(p_organization_id, 'team_members',
      private.team_seats_used(p_organization_id, p_email));
  end if;

  return private.invite_member(p_organization_id, p_email, p_role);
end;
$$;

-- @part 3: AI assistant: monthly plan allowance on top of the daily cap ------------

create or replace function public.assistant_consume(p_organization_id uuid, p_limit integer default 60)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_month integer;
  v_limit constant integer := 60;
begin
  if auth.uid() is null or not private.has_org_role(p_organization_id, 'viewer') then
    raise exception 'Not allowed' using errcode = 'PT403';
  end if;
  -- The row lock of today's counter serialises concurrent calls; a refused call
  -- rolls the increment back.
  insert into public.ai_usage as u (organization_id, feature, count)
  values (p_organization_id, 'assistant', 1)
  on conflict (organization_id, day, feature) do update set count = u.count + 1
  returning u.count into v_count;
  select coalesce(sum(u.count), 0)::integer into v_month from public.ai_usage u
  where u.organization_id = p_organization_id and u.feature = 'assistant'
    and u.day >= date_trunc('month', now() at time zone 'utc')::date;
  perform private.assert_within_limit(p_organization_id, 'assistant_requests_month', v_month - 1);
  if v_count > v_limit then
    raise exception 'Daily assistant limit reached' using errcode = 'PT429';
  end if;
  return v_limit - v_count;
end;
$$;
