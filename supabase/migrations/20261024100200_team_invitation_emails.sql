-- Team invitations that are actually e-mailed, accepted with a single-use link.
--
--   * create_organization_invitation(org, email, role): admin+ (owner for the
--     owner role), aal2 when the inviter has an authenticator app, valid e-mail,
--     not already a member, 20 invitations (sends and re-sends) per organization
--     per day. Returns the raw token ONCE so the dashboard server can e-mail
--     /auth/accept-invite?token=...; only its SHA-256 is stored, in the private
--     schema, with a 7-day expiry.
--   * resend_organization_invitation(id): new token (the old link stops working),
--     one re-send per 2 minutes and 5 per day per invitation.
--   * record_organization_invitation_email(id, sent): what Resend answered, so the
--     team page never says "sent" when it was not.
--   * revoke_organization_invitation(id): revoked (kept for the record), link dead.
--   * get_organization_invitation(token): what the accept page shows (anyone with
--     the link; 256-bit token).
--   * accept_organization_invitation(token): signed-in account with a confirmed
--     e-mail equal to the invited address; single use; 20 attempts per hour.
--     Returns a status instead of raising, so attempts are counted.
-- private.accept_invitations (join on e-mail confirmation) now skips revoked and
-- expired invitations and marks the link used. Every step is audited
-- (public.hq_audit_log through private.hq_log).

-- @part 5: columns, token table, helpers ------------------------------------------

alter table public.organization_invitations
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid,
  add column if not exists email_status text not null default 'pending'
    check (email_status in ('pending', 'sent', 'failed')),
  add column if not exists last_sent_at timestamptz,
  add column if not exists send_count integer not null default 0;

-- Hash of the single-use link. No foreign key on purpose (an orphan hash matches
-- nothing); the private schema is not exposed by the Data API.
create table if not exists private.organization_invitation_tokens (
  invitation_id uuid primary key,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table private.organization_invitation_tokens enable row level security;
revoke all on private.organization_invitation_tokens from public, anon, authenticated;

-- SHA-256 as lower-case hex (same as the dashboard: createHash(sha256).digest(hex)).
create or replace function private.sha256_hex(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_value, ''), 'UTF8')), 'hex');
$$;

-- 32 random bytes, base64url without padding (43 characters).
create or replace function private.new_url_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
$$;

revoke all on function private.sha256_hex(text) from public, anon, authenticated;
revoke all on function private.new_url_token() from public, anon, authenticated;

-- What the e-mail and the accept page need about one invitation.
create or replace function private.invitation_payload(p_invitation_id uuid, p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'invitation_id', i.id,
    'organization_id', i.organization_id,
    'organization_name', o.name,
    'website_name', (select coalesce(w.primary_domain, w.name) from public.websites w
                     where w.organization_id = o.id and w.status <> 'archived'
                     order by w.created_at, w.id limit 1),
    'email', i.email,
    'role', i.role,
    'expires_at', i.expires_at,
    'inviter_name', coalesce(nullif(btrim(p.full_name), ''), p.email, 'LevelUp'),
    'invitee_locale', (select u.raw_user_meta_data ->> 'locale' from auth.users u
                       where lower(u.email) = i.email and u.deleted_at is null limit 1),
    'token', p_token
  )
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  left join public.profiles p on p.id = i.invited_by
  where i.id = p_invitation_id;
$$;

revoke all on function private.invitation_payload(uuid, text) from public, anon, authenticated;

create index if not exists organization_invitations_revoked_by_idx
  on public.organization_invitations (revoked_by);

-- @part 6: create, re-send, record, revoke ------------------------------------------

create or replace function public.create_organization_invitation(
  p_organization_id uuid, p_email text, p_role text
)
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

create or replace function public.resend_organization_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.organization_invitations;
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  select * into v_inv from public.organization_invitations where id = p_invitation_id for update;
  if not found or not private.has_org_role(v_inv.organization_id, case when v_inv.role = 'owner' then 'owner' else 'admin' end) then
    raise exception 'invitation_not_found' using errcode = 'PT404';
  end if;
  perform private.assert_mfa();
  if v_inv.accepted_at is not null then
    raise exception 'invitation_accepted' using errcode = 'PT409';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'invitation_revoked' using errcode = 'PT409';
  end if;
  perform private.hit_rate_limit('invitation_resend', p_invitation_id::text, 1, interval '2 minutes');
  perform private.hit_rate_limit('invitation_resend_day', p_invitation_id::text, 5, interval '1 day');
  perform private.hit_rate_limit('org_invitations', v_inv.organization_id::text, 20, interval '1 day');

  v_token := private.new_url_token();
  update public.organization_invitations
  set expires_at = now() + interval '7 days', email_status = 'pending', invited_by = auth.uid()
  where id = p_invitation_id;
  insert into private.organization_invitation_tokens (invitation_id, token_hash, expires_at)
  values (p_invitation_id, private.sha256_hex(v_token), now() + interval '7 days')
  on conflict (invitation_id) do update
    set token_hash = excluded.token_hash, created_at = now(), expires_at = excluded.expires_at, used_at = null;

  perform private.hq_log('team.invitation_resent', 'organization', v_inv.organization_id::text,
    jsonb_build_object('invitation_id', p_invitation_id, 'email', v_inv.email));
  return private.invitation_payload(p_invitation_id, v_token);
end;
$$;

create or replace function public.record_organization_invitation_email(p_invitation_id uuid, p_sent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.organization_invitations;
begin
  select * into v_inv from public.organization_invitations where id = p_invitation_id for update;
  if not found or not private.has_org_role(v_inv.organization_id, 'admin') then
    raise exception 'invitation_not_found' using errcode = 'PT404';
  end if;
  update public.organization_invitations
  set email_status = case when p_sent then 'sent' else 'failed' end,
      last_sent_at = case when p_sent then now() else last_sent_at end,
      send_count = send_count + case when p_sent then 1 else 0 end
  where id = p_invitation_id;
  perform private.hq_log(
    case when p_sent then 'team.invitation_email_sent' else 'team.invitation_email_failed' end,
    'organization', v_inv.organization_id::text,
    jsonb_build_object('invitation_id', p_invitation_id, 'email', v_inv.email));
end;
$$;

create or replace function public.revoke_organization_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.organization_invitations;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  select * into v_inv from public.organization_invitations where id = p_invitation_id for update;
  if not found or not private.has_org_role(v_inv.organization_id, case when v_inv.role = 'owner' then 'owner' else 'admin' end) then
    raise exception 'invitation_not_found' using errcode = 'PT404';
  end if;
  perform private.assert_mfa();
  if v_inv.accepted_at is not null then
    raise exception 'invitation_accepted' using errcode = 'PT409';
  end if;
  if v_inv.revoked_at is not null then
    return;
  end if;
  update public.organization_invitations set revoked_at = now(), revoked_by = auth.uid()
  where id = p_invitation_id;
  update private.organization_invitation_tokens set expires_at = least(expires_at, now())
  where invitation_id = p_invitation_id;
  perform private.hq_log('team.invitation_revoked', 'organization', v_inv.organization_id::text,
    jsonb_build_object('invitation_id', p_invitation_id, 'email', v_inv.email));
end;
$$;

revoke all on function public.create_organization_invitation(uuid, text, text) from public, anon;
revoke all on function public.resend_organization_invitation(uuid) from public, anon;
revoke all on function public.record_organization_invitation_email(uuid, boolean) from public, anon;
revoke all on function public.revoke_organization_invitation(uuid) from public, anon;
grant execute on function public.create_organization_invitation(uuid, text, text) to authenticated;
grant execute on function public.resend_organization_invitation(uuid) to authenticated;
grant execute on function public.record_organization_invitation_email(uuid, boolean) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid) to authenticated;

-- @part 7: preview and accept -------------------------------------------------------

create or replace function private.invitation_link_status(
  p_accepted_at timestamptz, p_revoked_at timestamptz, p_expires_at timestamptz, p_used_at timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_accepted_at is not null then 'accepted'
    when p_revoked_at is not null then 'revoked'
    when p_used_at is not null then 'used'
    when p_expires_at <= now() then 'expired'
    else 'valid'
  end;
$$;

revoke all on function private.invitation_link_status(timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.get_organization_invitation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
  v_status text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select i.id, i.accepted_at, i.revoked_at, least(i.expires_at, t.expires_at) as expires_at, t.used_at,
         o.status as org_status
  into v
  from private.organization_invitation_tokens t
  join public.organization_invitations i on i.id = t.invitation_id
  join public.organizations o on o.id = i.organization_id
  where t.token_hash = private.sha256_hex(p_token);
  if not found or v.org_status = 'archived' then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_status := private.invitation_link_status(v.accepted_at, v.revoked_at, v.expires_at, v.used_at);
  if v_status in ('revoked', 'used') then
    return jsonb_build_object('status', v_status);
  end if;
  return private.invitation_payload(v.id, null) - 'token' - 'invitee_locale'
    || jsonb_build_object('status', v_status, 'expires_at', v.expires_at);
end;
$$;

revoke all on function public.get_organization_invitation(text) from public;
grant execute on function public.get_organization_invitation(text) to anon, authenticated;

create or replace function public.accept_organization_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v record;
  v_email text;
  v_confirmed boolean;
  v_status text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  perform private.hit_rate_limit('invitation_accept', v_uid::text, 20, interval '1 hour');
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select i.id, i.organization_id, i.email, i.role, i.accepted_at, i.accepted_by, i.revoked_at,
         least(i.expires_at, t.expires_at) as expires_at, t.used_at, o.name as org_name, o.status as org_status
  into v
  from private.organization_invitation_tokens t
  join public.organization_invitations i on i.id = t.invitation_id
  join public.organizations o on o.id = i.organization_id
  where t.token_hash = private.sha256_hex(p_token)
  for update of i, t;
  if not found or v.org_status = 'archived' then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Already accepted by this account (e.g. when the e-mail was confirmed): success.
  if v.accepted_at is not null then
    if v.accepted_by = v_uid then
      return jsonb_build_object('status', 'accepted', 'already', true, 'organization_id', v.organization_id,
        'organization_name', v.org_name, 'role', v.role);
    end if;
    return jsonb_build_object('status', 'used');
  end if;
  v_status := private.invitation_link_status(null, v.revoked_at, v.expires_at, v.used_at);
  if v_status <> 'valid' then
    return jsonb_build_object('status', v_status);
  end if;

  select lower(u.email), u.email_confirmed_at is not null into v_email, v_confirmed
  from auth.users u where u.id = v_uid;
  if not coalesce(v_confirmed, false) then
    return jsonb_build_object('status', 'email_unconfirmed');
  end if;
  if v_email is distinct from v.email then
    perform private.hq_log('team.invitation_email_mismatch', 'organization', v.organization_id::text,
      jsonb_build_object('invitation_id', v.id, 'user_id', v_uid));
    return jsonb_build_object('status', 'email_mismatch', 'invited_email', v.email);
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v.organization_id, v_uid, v.role)
  on conflict (organization_id, user_id) do update
    set role = case
      when private.role_rank(excluded.role) > private.role_rank(public.organization_members.role)
      then excluded.role else public.organization_members.role end;
  update public.organization_invitations set accepted_at = now(), accepted_by = v_uid where id = v.id;
  update private.organization_invitation_tokens set used_at = now() where invitation_id = v.id;

  perform private.hq_log('team.invitation_accepted', 'organization', v.organization_id::text,
    jsonb_build_object('invitation_id', v.id, 'user_id', v_uid, 'role', v.role));
  return jsonb_build_object('status', 'accepted', 'already', false, 'organization_id', v.organization_id,
    'organization_name', v.org_name, 'role', v.role);
end;
$$;

revoke all on function public.accept_organization_invitation(text) from public, anon;
grant execute on function public.accept_organization_invitation(text) to authenticated;

-- @part 8: join on e-mail confirmation, without revoked or expired invitations ---------

create or replace function private.accept_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv record;
begin
  if new.email_confirmed_at is null or new.email is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null and old.email is not distinct from new.email then
    return new;
  end if;

  for inv in
    select i.* from public.organization_invitations i
    join public.organizations o on o.id = i.organization_id
    where i.email = lower(new.email) and i.accepted_at is null and i.revoked_at is null
      and i.expires_at > now() and o.status <> 'archived'
    for update of i
  loop
    insert into public.organization_members (organization_id, user_id, role)
    values (inv.organization_id, new.id, inv.role)
    on conflict (organization_id, user_id) do update
      set role = case
        when private.role_rank(excluded.role) > private.role_rank(public.organization_members.role)
        then excluded.role else public.organization_members.role end;
    update public.organization_invitations set accepted_at = now(), accepted_by = new.id where id = inv.id;
    update private.organization_invitation_tokens set used_at = coalesce(used_at, now()) where invitation_id = inv.id;
    perform private.hq_log('team.invitation_accepted', 'organization', inv.organization_id::text,
      jsonb_build_object('invitation_id', inv.id, 'user_id', new.id, 'role', inv.role, 'via', 'email_confirmation'));
  end loop;
  return new;
end;
$$;

revoke execute on function private.accept_invitations() from public, anon, authenticated;
