-- Self-serve access for real clients, without blind approvals.
--
-- 1. Pre-registered owner e-mail per website (staff). When an account with a
--    CONFIRMED e-mail equal (case-insensitive, exact) to a pending owner e-mail
--    signs up or signs in, and the website organization has no owner yet, the
--    account becomes its owner, once (private.claim_site_ownership_for, called
--    by the e-mail confirmation trigger and by claim_site_ownership() after a
--    sign-in). Otherwise nothing happens.
-- 2. One-time activation codes (staff): LVL-XXXX-XXXX-XXXX, 12 Crockford base32
--    characters = 60 random bits, shown once, stored as SHA-256 only, single use,
--    7-day expiry, bound to one website and a role (owner by default), optionally
--    to an e-mail. Redeemed by a signed-in account with a confirmed e-mail through
--    redeem_activation_code(): 5 attempts per hour and 20 per day per account and
--    per client (IP hash given by the dashboard server); one uniform answer for an
--    unknown, used, revoked or wrongly bound code.
-- 3. The website id alone never grants anything (it is public: it appears in the
--    front-end code of every client site).
-- Staff functions need a platform admin on aal2 (private.assert_platform_admin);
-- everything is audited in public.hq_audit_log (private.hq_log).

-- @part 9: tables -------------------------------------------------------------------

create table if not exists private.website_owner_claims (
  id uuid primary key default gen_random_uuid(),
  website_id text not null references public.websites (id),
  email text not null check (char_length(email) between 6 and 254 and email = lower(btrim(email))),
  created_by uuid,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid,
  revoked_at timestamptz,
  revoked_by uuid
);
-- One pending claim per website and per e-mail address.
create unique index if not exists website_owner_claims_site_pending_uniq
  on private.website_owner_claims (website_id) where claimed_at is null and revoked_at is null;
create unique index if not exists website_owner_claims_email_pending_uniq
  on private.website_owner_claims (email) where claimed_at is null and revoked_at is null;
alter table private.website_owner_claims enable row level security;
revoke all on private.website_owner_claims from public, anon, authenticated;

create table if not exists private.website_activation_codes (
  id uuid primary key default gen_random_uuid(),
  website_id text not null references public.websites (id),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  code_hint text not null check (code_hint ~ '^[0-9A-HJKMNP-TV-Z]{4}$'),
  role text not null default 'owner' check (role in ('owner', 'admin', 'editor', 'viewer')),
  email text check (email is null or (char_length(email) between 6 and 254 and email = lower(btrim(email)))),
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid,
  revoked_at timestamptz,
  revoked_by uuid
);
create index if not exists website_activation_codes_site_idx
  on private.website_activation_codes (website_id, created_at desc);
alter table private.website_activation_codes enable row level security;
revoke all on private.website_activation_codes from public, anon, authenticated;

-- @part 10: code helpers ---------------------------------------------------------------

-- Crockford base32 (no I, L, O, U). 12 random bytes, 5 bits each (256 is a
-- multiple of 32, so every character is uniform): 60 bits.
create or replace function private.new_activation_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  b bytea := extensions.gen_random_bytes(12);
  a constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  s text := '';
  i integer;
begin
  for i in 0..11 loop
    s := s || substr(a, (get_byte(b, i) & 31) + 1, 1);
  end loop;
  return 'LVL-' || substr(s, 1, 4) || '-' || substr(s, 5, 4) || '-' || substr(s, 9, 4);
end;
$$;

-- What a person typed, as the 12 characters that are hashed: upper case, spaces,
-- dashes and underscores removed, the LVL prefix dropped, Crockford decoding
-- (O reads 0, I and L read 1). Null when it cannot be a code.
create or replace function private.normalize_activation_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  with c as (
    select regexp_replace(upper(coalesce(left(p_code, 64), '')), '[[:space:]_-]+', '', 'g') as v
  ), d as (
    select translate(case when char_length(v) = 15 and left(v, 3) = 'LVL' then substr(v, 4) else v end,
                     'OIL', '011') as v
    from c
  )
  select case when v ~ '^[0-9A-HJKMNP-TV-Z]{12}$' then v end from d;
$$;

create or replace function private.activation_code_status(
  p_used_at timestamptz, p_revoked_at timestamptz, p_expires_at timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_used_at is not null then 'used'
    when p_revoked_at is not null then 'revoked'
    when p_expires_at <= now() then 'expired'
    else 'active'
  end;
$$;

revoke all on function private.new_activation_code() from public, anon, authenticated;
revoke all on function private.normalize_activation_code(text) from public, anon, authenticated;
revoke all on function private.activation_code_status(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

-- @part 11: owner e-mail auto-link -------------------------------------------------------

create or replace function private.claim_site_ownership_for(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_confirmed boolean;
  c record;
begin
  select lower(u.email), u.email_confirmed_at is not null into v_email, v_confirmed
  from auth.users u where u.id = p_user_id and u.deleted_at is null;
  if v_email is null or not coalesce(v_confirmed, false) then
    return jsonb_build_object('status', 'none');
  end if;

  select cl.id, cl.website_id, w.name as website_name, w.organization_id
  into c
  from private.website_owner_claims cl
  join public.websites w on w.id = cl.website_id
  join public.organizations o on o.id = w.organization_id
  where cl.email = v_email and cl.claimed_at is null and cl.revoked_at is null
    and w.status <> 'archived' and o.status <> 'archived'
  for update of cl;
  if not found then
    return jsonb_build_object('status', 'none');
  end if;
  -- Only an organization without an owner can be claimed this way.
  perform 1 from public.organizations where id = c.organization_id for update;
  if exists (select 1 from public.organization_members m where m.organization_id = c.organization_id and m.role = 'owner') then
    return jsonb_build_object('status', 'none');
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (c.organization_id, p_user_id, 'owner')
  on conflict (organization_id, user_id) do update set role = 'owner';
  update private.website_owner_claims set claimed_at = now(), claimed_by = p_user_id where id = c.id;
  update public.access_requests
  set status = 'approved', organization_id = c.organization_id, website_id = c.website_id,
      reviewed_at = now(), updated_at = now()
  where user_id = p_user_id and status = 'pending';
  perform private.hq_log('site.owner_claimed', 'website', c.website_id,
    jsonb_build_object('user_id', p_user_id, 'email', v_email, 'organization_id', c.organization_id, 'claim_id', c.id));
  return jsonb_build_object('status', 'claimed', 'website_id', c.website_id, 'website_name', c.website_name,
    'organization_id', c.organization_id);
end;
$$;

revoke all on function private.claim_site_ownership_for(uuid) from public, anon, authenticated;

-- Called by the dashboard after every sign-in (and on the onboarding / pending
-- pages): links the signed-in account when a pending owner e-mail matches.
create or replace function public.claim_site_ownership()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  return private.claim_site_ownership_for(auth.uid());
end;
$$;

revoke all on function public.claim_site_ownership() from public, anon;
grant execute on function public.claim_site_ownership() to authenticated;

-- Sign-up confirmation, Google sign-up or e-mail change confirmation.
create or replace function private.claim_site_ownership_on_confirm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is null or new.email is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null and old.email is not distinct from new.email then
    return new;
  end if;
  perform private.claim_site_ownership_for(new.id);
  return new;
end;
$$;

revoke all on function private.claim_site_ownership_on_confirm() from public, anon, authenticated;

create or replace trigger on_auth_user_verified_claim_site
  after insert or update of email_confirmed_at, email on auth.users
  for each row execute function private.claim_site_ownership_on_confirm();

-- @part 12: staff functions ---------------------------------------------------------------

-- One website: owners, pending owner e-mail, activation codes (never the codes).
create or replace function public.admin_get_site_access(p_website_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_site record;
begin
  perform private.assert_platform_admin();
  select w.id, w.name, w.primary_domain, w.status, w.organization_id, o.name as org_name, o.status as org_status
  into v_site
  from public.websites w join public.organizations o on o.id = w.organization_id
  where w.id = lower(btrim(coalesce(p_website_id, '')));
  if not found then
    raise exception 'website_not_found' using errcode = 'PT404';
  end if;
  return jsonb_build_object(
    'website', jsonb_build_object('id', v_site.id, 'name', v_site.name, 'primary_domain', v_site.primary_domain,
      'status', v_site.status, 'organization_id', v_site.organization_id,
      'organization_name', v_site.org_name, 'organization_status', v_site.org_status),
    'owners', coalesce((
      select jsonb_agg(jsonb_build_object('email', u.email, 'full_name', p.full_name) order by m.created_at)
      from public.organization_members m
      join auth.users u on u.id = m.user_id
      left join public.profiles p on p.id = m.user_id
      where m.organization_id = v_site.organization_id and m.role = 'owner'
    ), '[]'::jsonb),
    'members', (select count(*)::int from public.organization_members m where m.organization_id = v_site.organization_id),
    'owner_claim', (
      select jsonb_build_object('email', cl.email, 'created_at', cl.created_at)
      from private.website_owner_claims cl
      where cl.website_id = v_site.id and cl.claimed_at is null and cl.revoked_at is null
    ),
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id, 'hint', k.code_hint, 'role', k.role, 'email', k.email,
        'status', private.activation_code_status(k.used_at, k.revoked_at, k.expires_at),
        'created_at', k.created_at, 'expires_at', k.expires_at, 'used_at', k.used_at,
        'used_by_email', (select u.email from auth.users u where u.id = k.used_by)
      ) order by k.created_at desc)
      from (select * from private.website_activation_codes x where x.website_id = v_site.id
            order by x.created_at desc limit 50) as k
    ), '[]'::jsonb)
  );
end;
$$;

-- Sets (or, with an empty e-mail, clears) the pending owner e-mail of a website.
create or replace function public.admin_set_site_owner_email(p_website_id text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site record;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_current private.website_owner_claims;
  v_claim jsonb;
begin
  perform private.assert_platform_admin();
  select w.id, w.status, w.organization_id, o.status as org_status
  into v_site
  from public.websites w join public.organizations o on o.id = w.organization_id
  where w.id = lower(btrim(coalesce(p_website_id, '')))
  for update of w;
  if not found then
    raise exception 'website_not_found' using errcode = 'PT404';
  end if;
  if v_site.status = 'archived' or v_site.org_status = 'archived' then
    raise exception 'website_archived' using errcode = 'PT409';
  end if;
  select * into v_current from private.website_owner_claims
  where website_id = v_site.id and claimed_at is null and revoked_at is null for update;

  if v_email is null then
    if v_current.id is not null then
      update private.website_owner_claims set revoked_at = now(), revoked_by = auth.uid() where id = v_current.id;
      perform private.hq_log('site.owner_email_cleared', 'website', v_site.id,
        jsonb_build_object('email', v_current.email));
    end if;
    return jsonb_build_object('owner_email', null);
  end if;

  if not private.is_valid_email(v_email) then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if exists (select 1 from public.organization_members m where m.organization_id = v_site.organization_id and m.role = 'owner') then
    raise exception 'organization_has_owner' using errcode = 'PT409';
  end if;
  if v_current.email = v_email then
    return jsonb_build_object('owner_email', v_email);
  end if;
  if exists (select 1 from private.website_owner_claims cl
             where cl.email = v_email and cl.claimed_at is null and cl.revoked_at is null) then
    raise exception 'email_pending_elsewhere' using errcode = 'PT409';
  end if;
  if v_current.id is not null then
    update private.website_owner_claims set revoked_at = now(), revoked_by = auth.uid() where id = v_current.id;
  end if;
  insert into private.website_owner_claims (website_id, email, created_by)
  values (v_site.id, v_email, auth.uid());
  perform private.hq_log('site.owner_email_set', 'website', v_site.id,
    jsonb_build_object('email', v_email, 'replaced', v_current.email));

  -- The account may exist already (confirmed e-mail): linked at its next sign-in.
  return jsonb_build_object('owner_email', v_email);
end;
$$;

-- A new activation code, returned ONCE (only its hash is kept).
create or replace function public.admin_create_activation_code(
  p_website_id text, p_role text default 'owner', p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site record;
  v_role text := coalesce(nullif(btrim(coalesce(p_role, '')), ''), 'owner');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_code text;
  v_norm text;
  v_id uuid;
  v_expires timestamptz := now() + interval '7 days';
begin
  perform private.assert_platform_admin();
  if v_role not in ('owner', 'admin', 'editor', 'viewer') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if v_email is not null and not private.is_valid_email(v_email) then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  select w.id, w.name, w.status, o.status as org_status
  into v_site
  from public.websites w join public.organizations o on o.id = w.organization_id
  where w.id = lower(btrim(coalesce(p_website_id, '')));
  if not found then
    raise exception 'website_not_found' using errcode = 'PT404';
  end if;
  if v_site.status = 'archived' or v_site.org_status = 'archived' then
    raise exception 'website_archived' using errcode = 'PT409';
  end if;
  if (select count(*) from private.website_activation_codes k
      where k.website_id = v_site.id and k.used_at is null and k.revoked_at is null and k.expires_at > now()) >= 5 then
    raise exception 'too_many_codes' using errcode = 'PT409';
  end if;
  perform private.hit_rate_limit('activation_code_create', auth.uid()::text, 30, interval '1 day');

  v_code := private.new_activation_code();
  v_norm := private.normalize_activation_code(v_code);
  insert into private.website_activation_codes (website_id, code_hash, code_hint, role, email, created_by, expires_at)
  values (v_site.id, private.sha256_hex(v_norm), right(v_norm, 4), v_role, v_email, auth.uid(), v_expires)
  returning id into v_id;
  perform private.hq_log('site.activation_code_created', 'website', v_site.id,
    jsonb_build_object('code_id', v_id, 'role', v_role, 'email', v_email, 'expires_at', v_expires));
  return jsonb_build_object('id', v_id, 'code', v_code, 'role', v_role, 'email', v_email,
    'expires_at', v_expires, 'website_id', v_site.id, 'website_name', v_site.name);
end;
$$;

create or replace function public.admin_revoke_activation_code(p_code_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v private.website_activation_codes;
begin
  perform private.assert_platform_admin();
  select * into v from private.website_activation_codes where id = p_code_id for update;
  if not found then
    raise exception 'code_not_found' using errcode = 'PT404';
  end if;
  if v.used_at is not null or v.revoked_at is not null then
    return;
  end if;
  update private.website_activation_codes set revoked_at = now(), revoked_by = auth.uid() where id = p_code_id;
  perform private.hq_log('site.activation_code_revoked', 'website', v.website_id,
    jsonb_build_object('code_id', p_code_id));
end;
$$;

revoke all on function public.admin_get_site_access(text) from public, anon;
revoke all on function public.admin_set_site_owner_email(text, text) from public, anon;
revoke all on function public.admin_create_activation_code(text, text, text) from public, anon;
revoke all on function public.admin_revoke_activation_code(uuid) from public, anon;
grant execute on function public.admin_get_site_access(text) to authenticated;
grant execute on function public.admin_set_site_owner_email(text, text) to authenticated;
grant execute on function public.admin_create_activation_code(text, text, text) to authenticated;
grant execute on function public.admin_revoke_activation_code(uuid) to authenticated;

-- @part 13: redeem ---------------------------------------------------------------------------

-- p_client: SHA-256 hex of the client IP, given by the dashboard server (a direct
-- caller can omit or vary it, the per-account limits still apply).
-- Answers (never raises after the rate limits, so every attempt is counted):
-- activated | already_member | expired | invalid | email_unconfirmed.
create or replace function public.redeem_activation_code(p_code text, p_client text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed boolean;
  v_norm text;
  v record;
  v_code_id uuid;
  v_reason text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  select lower(u.email), u.email_confirmed_at is not null into v_email, v_confirmed
  from auth.users u where u.id = v_uid;
  if not coalesce(v_confirmed, false) then
    return jsonb_build_object('status', 'email_unconfirmed');
  end if;

  perform private.hit_rate_limit('activation_user_hour', v_uid::text, 5, interval '1 hour');
  perform private.hit_rate_limit('activation_user_day', v_uid::text, 20, interval '1 day');
  if p_client is not null and p_client ~ '^[0-9a-f]{64}$' then
    perform private.hit_rate_limit('activation_client_hour', p_client, 5, interval '1 hour');
    perform private.hit_rate_limit('activation_client_day', p_client, 20, interval '1 day');
  end if;

  v_norm := private.normalize_activation_code(p_code);
  if v_norm is null then
    v_reason := 'format';
  else
    select k.id, k.website_id, k.role, k.email, k.used_at, k.revoked_at, k.expires_at,
           w.name as website_name, w.status as site_status, w.organization_id, o.name as org_name,
           o.status as org_status
    into v
    from private.website_activation_codes k
    join public.websites w on w.id = k.website_id
    join public.organizations o on o.id = w.organization_id
    where k.code_hash = private.sha256_hex(v_norm)
    for update of k;
    if not found then
      v_reason := 'unknown';
    else
      v_code_id := v.id;
      v_reason := case
        when v.used_at is not null then 'used'
        when v.revoked_at is not null then 'revoked'
        when v.email is not null and v.email <> v_email then 'email'
        when v.site_status = 'archived' or v.org_status = 'archived' then 'archived'
        when v.expires_at <= now() then 'expired'
        when exists (select 1 from public.organization_members m
                     where m.organization_id = v.organization_id and m.user_id = v_uid) then 'member'
      end;
    end if;
  end if;
  if v_reason is not null then
    perform private.hq_log('site.activation_code_failed', 'account', v_uid::text,
      jsonb_build_object('reason', v_reason, 'code_id', v_code_id));
    return jsonb_build_object('status', case v_reason
      when 'expired' then 'expired'
      when 'member' then 'already_member'
      else 'invalid' end);
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v.organization_id, v_uid, v.role);
  update private.website_activation_codes set used_at = now(), used_by = v_uid where id = v.id;
  update public.access_requests
  set status = 'approved', organization_id = v.organization_id, website_id = v.website_id,
      reviewed_at = now(), updated_at = now()
  where user_id = v_uid and status <> 'approved';
  perform private.hq_log('site.activation_code_redeemed', 'website', v.website_id,
    jsonb_build_object('code_id', v.id, 'user_id', v_uid, 'role', v.role, 'organization_id', v.organization_id));
  return jsonb_build_object('status', 'activated', 'website_id', v.website_id, 'website_name', v.website_name,
    'organization_id', v.organization_id, 'organization_name', v.org_name, 'role', v.role);
end;
$$;

revoke all on function public.redeem_activation_code(text, text) from public, anon;
grant execute on function public.redeem_activation_code(text, text) to authenticated;
