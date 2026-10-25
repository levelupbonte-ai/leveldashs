-- Per-site server keys and the client-side audit log.
--
-- The server of a website (never its browser) authenticates to LevelUp with a
-- key `lu_live_<48 hex>` / `lu_test_<48 hex>` kept in an environment variable
-- (LEVELUP_SITE_KEY). Only the SHA-256 of the key is stored; the full key is
-- returned once by site_create_api_key and never again. Owners and admins of
-- the organization create, list and revoke keys; every change is written to
-- site_audit_log inside the same function.

-- ---------------------------------------------------------------- audit log

create table if not exists public.site_audit_log (
  id bigint generated always as identity primary key,
  website_id text not null,
  organization_id uuid not null,
  actor_id uuid,
  action text not null
    check (char_length(action) <= 80 and action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  target_id text check (target_id is null or char_length(target_id) <= 80),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4000),
  created_at timestamptz not null default now(),
  foreign key (website_id, organization_id)
    references public.websites (id, organization_id) on delete cascade
);

create index if not exists site_audit_log_site_idx
  on public.site_audit_log (website_id, created_at desc);

alter table public.site_audit_log enable row level security;
revoke all on public.site_audit_log from public, anon, authenticated;
grant select on public.site_audit_log to authenticated;

drop policy if exists site_audit_log_admin_read on public.site_audit_log;
create policy site_audit_log_admin_read on public.site_audit_log
  for select to authenticated
  using (private.has_org_role(organization_id, 'admin'));

-- Append-only: written by SECURITY DEFINER functions only.
create or replace function private.site_audit(
  p_website_id text,
  p_organization_id uuid,
  p_action text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.site_audit_log (website_id, organization_id, actor_id, action, target_id, metadata)
  values (p_website_id, p_organization_id, (select auth.uid()), p_action, p_target_id,
          coalesce(p_metadata, '{}'::jsonb));
$$;

revoke all on function private.site_audit(text, uuid, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- keys

create table if not exists public.site_api_keys (
  id uuid primary key default gen_random_uuid(),
  website_id text not null,
  organization_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  prefix text not null check (prefix in ('lu_live_', 'lu_test_')),
  key_hint text not null check (key_hint ~ '^[0-9a-f]{4}$'),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null
    check (cardinality(scopes) between 1 and 8
      and scopes <@ array['payments:write', 'events:write']::text[]),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  foreign key (website_id, organization_id)
    references public.websites (id, organization_id) on delete cascade
);

create index if not exists site_api_keys_site_idx on public.site_api_keys (website_id, created_at desc);

alter table public.site_api_keys enable row level security;
revoke all on public.site_api_keys from public, anon, authenticated;
-- The hash never leaves the database.
grant select (id, website_id, organization_id, name, prefix, key_hint, scopes, created_by,
              created_at, last_used_at, revoked_at)
  on public.site_api_keys to authenticated;

drop policy if exists site_api_keys_admin_read on public.site_api_keys;
create policy site_api_keys_admin_read on public.site_api_keys
  for select to authenticated
  using (private.has_org_role(organization_id, 'admin'));

-- Creates a key and returns it once: { id, key, prefix, key_hint }.
create or replace function public.site_create_api_key(
  p_website_id text,
  p_name text,
  p_mode text default 'live',
  p_scopes text[] default array['payments:write']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text;
  v_scopes text[];
  v_prefix text;
  v_secret text;
  v_key text;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  select organization_id into v_org
  from public.websites
  where id = p_website_id and status <> 'archived';
  if v_org is null or not private.has_org_role(v_org, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_mfa();
  perform private.assert_org_unlocked(v_org);

  v_name := private.check_text(p_name, 80, 'name');
  if v_name is null then
    raise exception 'A name is required' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('live', 'test') then
    raise exception 'Invalid mode' using errcode = '22023';
  end if;
  select array_agg(distinct s order by s) into v_scopes from unnest(p_scopes) as s;
  if v_scopes is null or cardinality(v_scopes) = 0
     or not (v_scopes <@ array['payments:write', 'events:write']::text[]) then
    raise exception 'Invalid scopes' using errcode = '22023';
  end if;
  if (select count(*) from public.site_api_keys
      where website_id = p_website_id and revoked_at is null) >= 10 then
    raise exception 'Too many active keys' using errcode = 'PT409';
  end if;
  perform private.hit_rate_limit('site_api_key_create', (select auth.uid())::text, 20, interval '1 hour');

  v_prefix := 'lu_' || p_mode || '_';
  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  v_key := v_prefix || v_secret;

  insert into public.site_api_keys (website_id, organization_id, name, prefix, key_hint, key_hash,
                                    scopes, created_by)
  values (p_website_id, v_org, v_name, v_prefix, right(v_secret, 4),
          encode(extensions.digest(v_key, 'sha256'), 'hex'), v_scopes, (select auth.uid()))
  returning id into v_id;

  perform private.site_audit(p_website_id, v_org, 'api_key.created', v_id::text,
    jsonb_build_object('name', v_name, 'prefix', v_prefix, 'key_hint', right(v_secret, 4),
                       'scopes', to_jsonb(v_scopes)));

  return jsonb_build_object('id', v_id, 'key', v_key, 'prefix', v_prefix,
                            'key_hint', right(v_secret, 4));
end;
$$;

create or replace function public.site_revoke_api_key(p_key_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.site_api_keys;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  select * into v_key from public.site_api_keys where id = p_key_id;
  if not found or not private.has_org_role(v_key.organization_id, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_mfa();
  if v_key.revoked_at is not null then
    return;
  end if;
  update public.site_api_keys
  set revoked_at = now(), revoked_by = (select auth.uid())
  where id = p_key_id;
  perform private.site_audit(v_key.website_id, v_key.organization_id, 'api_key.revoked',
    p_key_id::text, jsonb_build_object('name', v_key.name, 'prefix', v_key.prefix,
                                       'key_hint', v_key.key_hint));
end;
$$;

revoke all on function public.site_create_api_key(text, text, text, text[]) from public, anon;
revoke all on function public.site_revoke_api_key(uuid) from public, anon;
grant execute on function public.site_create_api_key(text, text, text, text[]) to authenticated;
grant execute on function public.site_revoke_api_key(uuid) to authenticated;

-- Resolves a server key for one scope: raises PT401 (unknown, malformed or
-- revoked key), PT403 (scope missing) or PT429 (more than 300 calls in 10
-- minutes), records last_used_at (at most once a minute).
create or replace function private.site_key_website(p_key text, p_scope text)
returns table (key_id uuid, website_id text, organization_id uuid, livemode boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_site text;
  v_org uuid;
  v_prefix text;
  v_scopes text[];
  v_revoked timestamptz;
begin
  if p_key is null or p_key !~ '^lu_(live|test)_[0-9a-f]{48}$' then
    raise exception 'Invalid key' using errcode = 'PT401';
  end if;
  select k.id, k.website_id, k.organization_id, k.prefix, k.scopes, k.revoked_at
  into v_id, v_site, v_org, v_prefix, v_scopes, v_revoked
  from public.site_api_keys k
  join public.websites w on w.id = k.website_id
  join public.organizations o on o.id = k.organization_id
  where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
    and w.status <> 'archived'
    and o.status <> 'archived';
  if v_id is null or v_revoked is not null then
    raise exception 'Invalid key' using errcode = 'PT401';
  end if;
  if p_scope is null or not (p_scope = any (v_scopes)) then
    raise exception 'This key is not allowed to do that' using errcode = 'PT403';
  end if;
  perform private.hit_rate_limit('site_key', v_id::text, 300, interval '10 minutes');
  update public.site_api_keys
  set last_used_at = now()
  where id = v_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return query select v_id, v_site, v_org, v_prefix = 'lu_live_';
end;
$$;

revoke all on function private.site_key_website(text, text) from public, anon, authenticated;
