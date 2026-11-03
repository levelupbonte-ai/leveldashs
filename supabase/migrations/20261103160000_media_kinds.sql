-- Which kinds of media each client may upload (image, video, document),
-- chosen by LevelUp in HQ. Enforced by the database on every upload path
-- (R2 bookings and Supabase Storage registrations), so no screen can bypass it.
-- Default for every client: images and documents; videos only when LevelUp
-- turns them on (they are the heaviest files).

create table if not exists public.organization_media_policy (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  kinds text[] not null default array['image', 'document']
    check (kinds <@ array['image', 'video', 'document'] and cardinality(kinds) <= 3),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.organization_media_policy enable row level security;
revoke all on public.organization_media_policy from anon, authenticated;
grant select on public.organization_media_policy to authenticated;
drop policy if exists organization_media_policy_read on public.organization_media_policy;
create policy organization_media_policy_read on public.organization_media_policy
  for select to authenticated
  using (private.has_org_role(organization_id, 'viewer') or private.is_platform_admin());

create or replace function private.media_kind(p_mime text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_mime like 'image/%' then 'image'
    when p_mime like 'video/%' then 'video'
    else 'document'
  end;
$$;

create or replace function private.org_media_kinds(p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.kinds from public.organization_media_policy p where p.organization_id = p_org),
                  array['image', 'document']);
$$;

create or replace function private.assert_media_kind(p_org uuid, p_mime text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.media_kind(p_mime) = any (private.org_media_kinds(p_org))) then
    raise exception 'media_kind_not_allowed' using errcode = 'PT403', hint = private.media_kind(p_mime);
  end if;
end;
$$;

-- R2 bookings: check the kind right after the type.
do $do$
declare
  d text := pg_get_functiondef('public.media_r2_reserve(text,text,text,bigint,bigint)'::regprocedure);
  anchor text := $a$  perform private.hit_rate_limit('media_r2_reserve'$a$;
begin
  if position('assert_media_kind' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'media_r2_reserve: unexpected body, not patched';
  end if;
  d := replace(d, anchor, $ins$  perform private.assert_media_kind(v_org, p_mime);
$ins$ || anchor);
  execute d;
end;
$do$;

-- Every registration (both buckets): the kind of the declared type.
do $do$
declare
  d text := pg_get_functiondef('private.media_before_insert()'::regprocedure);
  anchor text := $a$  if new.bucket = 'r2' then$a$;
begin
  if position('assert_media_kind' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'media_before_insert: unexpected body, not patched';
  end if;
  d := replace(d, anchor, $ins$  if (select auth.uid()) is not null then
    perform private.assert_media_kind(new.organization_id, coalesce(new.mime_type, ''));
  end if;
$ins$ || anchor);
  execute d;
end;
$do$;

-- HQ: set a client's allowed kinds (role with clients.write, fresh code not
-- needed: reversible, logged in the HQ audit log).
create or replace function public.hq_set_media_kinds(p_org uuid, p_kinds text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kinds text[];
begin
  perform private.hq_assert('clients.write');
  if p_org is null or not exists (select 1 from public.organizations o where o.id = p_org) then
    raise exception 'Unknown client' using errcode = 'PT404';
  end if;
  select coalesce(array_agg(distinct k order by k), array[]::text[]) into v_kinds
  from unnest(coalesce(p_kinds, array[]::text[])) k;
  if not (v_kinds <@ array['image', 'video', 'document']) then
    raise exception 'Invalid kinds' using errcode = '22023';
  end if;
  insert into public.organization_media_policy (organization_id, kinds, updated_at, updated_by)
  values (p_org, v_kinds, now(), (select auth.uid()))
  on conflict (organization_id) do update
    set kinds = excluded.kinds, updated_at = now(), updated_by = excluded.updated_by;
  perform private.hq_log('client.media_kinds', 'organization', p_org::text, jsonb_build_object('kinds', v_kinds));
  return v_kinds;
end;
$$;
revoke all on function public.hq_set_media_kinds(uuid, text[]) from public, anon;
grant execute on function public.hq_set_media_kinds(uuid, text[]) to authenticated;

-- Library stats also say which kinds this client may upload.
do $do$
declare
  d text := pg_get_functiondef('public.media_library_stats(text)'::regprocedure);
begin
  if position('allowed_kinds' in d) > 0 then
    return;
  end if;
  d := replace(d, $o$    'org_bytes', (select u.bytes from private.org_storage_usage(v_org) u),$o$,
                  $n$    'allowed_kinds', to_jsonb(private.org_media_kinds(v_org)),
    'org_bytes', (select u.bytes from private.org_storage_usage(v_org) u),$n$);
  if position('allowed_kinds' in d) = 0 then
    raise exception 'media_library_stats: unexpected body, not patched';
  end if;
  execute d;
end;
$do$;
