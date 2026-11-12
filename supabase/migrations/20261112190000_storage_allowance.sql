-- Storage is no longer promised in GB per plan. Each organization gets the
-- storage LevelUp gives it (private.org_storage_allowance, set by HQ staff with
-- hq_set_storage_allowance); without an allowance the plan's internal default
-- applies (never shown to clients). Storage counts every file of the
-- organization: media, brand, form uploads, portal documents.
-- Applied as migration storage_allowance.

create table if not exists private.org_storage_allowance (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  storage_mb integer check (storage_mb is null or storage_mb > 0),
  note text check (char_length(note) <= 200),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
revoke all on private.org_storage_allowance from public, anon, authenticated;

-- media_mb: the organization's allowance first (null there = no limit), then the plan default.
create or replace function private.plan_limit(p_org uuid, p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_key = 'media_mb' and exists (select 1 from private.org_storage_allowance a where a.organization_id = p_org)
      then (select a.storage_mb from private.org_storage_allowance a where a.organization_id = p_org)
    else (select (p.limits ->> p_key)::integer from public.plans p where p.key = private.org_plan_key(p_org))
  end;
$$;

create or replace function private.org_storage_usage(p_org uuid)
returns table(bytes bigint, files bigint, media_bytes bigint, media_files bigint, thumbnail_bytes bigint, brand_bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with objs as (
    select o.bucket_id, o.name, coalesce((o.metadata ->> 'size')::bigint, 0) as size
    from storage.objects o
    where p_org is not null
      and o.archived_at is null
      and not coalesce(o.is_delete_marker, false)
      and (
        (o.bucket_id = 'media'
          and o.name collate "C" >= ('org/' || p_org::text || '/')
          and o.name collate "C" < ('org/' || p_org::text || '0'))
        or (o.bucket_id = 'media'
          and o.name collate "C" >= (p_org::text || '/')
          and o.name collate "C" < (p_org::text || '0'))
        or (o.bucket_id = 'brand'
          and o.name collate "C" >= ('orgs/' || p_org::text || '/')
          and o.name collate "C" < ('orgs/' || p_org::text || '0'))
        or (o.bucket_id = 'portal-documents'
          and o.name collate "C" >= ('org/' || p_org::text || '/')
          and o.name collate "C" < ('org/' || p_org::text || '0'))
        or (o.bucket_id = 'form-uploads'
          and exists (select 1 from public.site_forms f join public.websites w on w.id = f.website_id
                      where w.organization_id = p_org and o.name like f.id::text || '/%'))
      )
  ),
  r2 as (
    select m.size_bytes as size, m.thumb_size_bytes as thumb from public.media m
    where m.organization_id = p_org and m.bucket = 'r2'
    union all
    select p.size_bytes, p.thumb_size_bytes from private.media_r2_pending p
    where p.organization_id = p_org and p.used_at is null
  )
  select
    (coalesce((select sum(size) from objs), 0) + coalesce((select sum(size + thumb) from r2), 0))::bigint,
    ((select count(*) from objs where name !~ '_thumb\.webp$') + (select count(*) from r2))::bigint,
    (coalesce((select sum(size) from objs where bucket_id = 'media'), 0) + coalesce((select sum(size + thumb) from r2), 0))::bigint,
    ((select count(*) from objs where bucket_id = 'media' and name !~ '_thumb\.webp$') + (select count(*) from r2))::bigint,
    (coalesce((select sum(size) from objs where bucket_id = 'media' and name ~ '_thumb\.webp$'), 0) + coalesce((select sum(thumb) from r2), 0))::bigint,
    coalesce((select sum(size) from objs where bucket_id = 'brand'), 0)::bigint;
$$;

-- HQ: give an organization its storage (MB; null = no limit), logged.
create or replace function public.hq_set_storage_allowance(p_org uuid, p_storage_mb integer, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.hq_assert('clients.write');
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'Unknown organization' using errcode = 'PT404';
  end if;
  if p_storage_mb is not null and (p_storage_mb < 1 or p_storage_mb > 10000000) then
    raise exception 'Invalid storage' using errcode = '22023';
  end if;
  insert into private.org_storage_allowance (organization_id, storage_mb, note, updated_by)
  values (p_org, p_storage_mb, private.check_text(p_note, 200, 'note'), (select auth.uid()))
  on conflict (organization_id) do update
    set storage_mb = excluded.storage_mb, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  perform private.hq_log('storage.allowance_set', 'organization', p_org::text,
    jsonb_build_object('storage_mb', p_storage_mb));
end;
$$;
revoke all on function public.hq_set_storage_allowance(uuid, integer, text) from public, anon;
grant execute on function public.hq_set_storage_allowance(uuid, integer, text) to authenticated;
