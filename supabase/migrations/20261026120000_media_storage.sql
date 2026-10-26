-- Media storage that scales: strict object layout, immutable files, a trusted
-- media index (sizes come from Storage, not from the browser), cursor
-- pagination, per-website stats and per-organization storage usage.
--
-- Layout of new uploads in the public `media` bucket:
--   org/<organization id>/site/<website id>/<yyyy>/<mm>/<uuid>.<ext>
--   org/<organization id>/site/<website id>/<yyyy>/<mm>/<uuid>_thumb.webp   (thumbnail)
-- Files uploaded before this migration keep the legacy layout
--   <organization id>/<website id>/<file>
-- and stay readable and deletable; nothing new is written there.
--
-- Objects are immutable (no UPDATE policy): every upload gets a new name, so the
-- one-year `Cache-Control` set by the dashboard is always safe for the CDN.

-- ---------------------------------------------------------------- path helpers

create or replace function private.media_path_ok(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_name ~ ('^org/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    || '/site/ws_[a-z0-9]{8,32}/20[2-9][0-9]/(0[1-9]|1[0-2])/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    || '(_thumb\.webp|\.(jpg|png|webp|gif|avif|pdf|mp4|webm))$'), false);
$$;

-- Organization / website of a media object name, for both layouts.
create or replace function private.media_object_org(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name like 'org/%' then private.safe_uuid(split_part(p_name, '/', 2))
    else private.safe_uuid(split_part(p_name, '/', 1))
  end;
$$;

create or replace function private.media_object_site(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name like 'org/%' then split_part(p_name, '/', 4)
    else split_part(p_name, '/', 2)
  end;
$$;

create or replace function private.media_mime_for_ext(p_ext text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_ext
    when 'jpg' then 'image/jpeg'
    when 'png' then 'image/png'
    when 'webp' then 'image/webp'
    when 'gif' then 'image/gif'
    when 'avif' then 'image/avif'
    when 'pdf' then 'application/pdf'
    when 'mp4' then 'video/mp4'
    when 'webm' then 'video/webm'
  end;
$$;

-- Read / delete check (both layouts). Kept with the same signature.
create or replace function private.can_access_media_path(object_name text, min_role text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_site text;
begin
  if object_name is null or position('..' in object_name) > 0 then
    return false;
  end if;
  if object_name like 'org/%' then
    if not private.media_path_ok(object_name) then
      return false;
    end if;
  elsif split_part(object_name, '/', 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(object_name, '/', 2) !~ '^ws_[a-z0-9]{8,32}$'
     or split_part(object_name, '/', 3) = '' then
    return false;
  end if;
  v_org := private.media_object_org(object_name);
  v_site := private.media_object_site(object_name);
  return v_org is not null
    and exists (select 1 from public.websites w where w.id = v_site and w.organization_id = v_org)
    and private.has_org_role(v_org, min_role);
end;
$$;

-- Upload check: new layout only, editor and above, live (non-archived) website.
create or replace function private.can_upload_media_path(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_site text;
begin
  if not private.media_path_ok(object_name) then
    return false;
  end if;
  v_org := private.media_object_org(object_name);
  v_site := private.media_object_site(object_name);
  return v_org is not null
    and exists (
      select 1 from public.websites w
      where w.id = v_site and w.organization_id = v_org and w.status <> 'archived')
    and private.has_org_role(v_org, 'editor');
end;
$$;

revoke all on function private.media_path_ok(text) from public, anon, authenticated;
-- media_object_org runs inside the storage policies (as the caller): pure parsing.
revoke all on function private.media_object_org(text) from public, anon;
grant execute on function private.media_object_org(text) to authenticated;
revoke all on function private.media_object_site(text) from public, anon, authenticated;
revoke all on function private.media_mime_for_ext(text) from public, anon, authenticated;
revoke all on function private.can_upload_media_path(text) from public, anon;
grant execute on function private.can_upload_media_path(text) to authenticated;

-- ---------------------------------------------------------------- storage policies

-- ALTER POLICY keeps the policies' names and roles and only swaps the checks.
alter policy media_objects_insert on storage.objects
  with check (bucket_id = 'media' and private.can_upload_media_path(name));

-- Immutable objects: no overwrite, no move (a moved or replaced file would stay
-- cached for a year under its old content).
alter policy media_objects_update on storage.objects
  using (false)
  with check (false);

-- The contract gate reads the organization from both layouts.
alter policy media_objects_contract_insert on storage.objects
  with check (bucket_id <> 'media' or not private.org_contract_locked(private.media_object_org(name)));

alter policy media_objects_contract_update on storage.objects
  using (bucket_id <> 'media' or not private.org_contract_locked(private.media_object_org(name)))
  with check (bucket_id <> 'media' or not private.org_contract_locked(private.media_object_org(name)));

alter policy media_objects_contract_delete on storage.objects
  using (bucket_id <> 'media' or not private.org_contract_locked(private.media_object_org(name)));

-- ---------------------------------------------------------------- media index

alter table public.media
  add column if not exists thumb_path text,
  add column if not exists thumb_size_bytes bigint not null default 0;

-- The only destructive statement: the legacy CHECK allowed `<org>/<site>/` paths
-- only; it is replaced by one that accepts both layouts (no data is touched).
alter table public.media drop constraint if exists media_check;
alter table public.media add constraint media_path_in_tenant check (
  starts_with(storage_path, organization_id::text || '/' || website_id || '/')
  or starts_with(storage_path, 'org/' || organization_id::text || '/site/' || website_id || '/'));

alter table public.media add constraint media_thumb_path_check check (
  thumb_path is null
  or thumb_path = regexp_replace(storage_path, '\.[a-z0-9]+$', '_thumb.webp'));

alter table public.media add constraint media_thumb_size_check
  check (thumb_size_bytes between 0 and 2097152);

alter table public.media add constraint media_dimensions_max
  check ((width is null or width <= 20000) and (height is null or height <= 20000));

-- Cursor pagination: newest first, id as the tie-breaker.
create index if not exists media_site_cursor_idx
  on public.media (website_id, created_at desc, id desc);

grant select (thumb_path, thumb_size_bytes) on public.media to authenticated;
grant insert (thumb_path) on public.media to authenticated;

-- Every new row must describe an object that really is in Storage, in the new
-- layout, inside the row's organization / website. Size and type are copied
-- from the stored object (the browser cannot under-report them); the
-- extension must match the type.
create or replace function private.media_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_size bigint;
  v_mime text;
  v_thumb_size bigint;
  v_thumb_mime text;
begin
  -- Same answers as RLS / the composite foreign key, checked first so a refused
  -- row gets the usual error. Trusted server tooling (no user) skips the role check.
  if (select auth.uid()) is not null and not private.has_org_role(new.organization_id, 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.websites w
                 where w.id = new.website_id and w.organization_id = new.organization_id) then
    raise exception 'Unknown website for this organization' using errcode = '23503';
  end if;
  if new.bucket is distinct from 'media' then
    raise exception 'Invalid bucket' using errcode = '22023';
  end if;
  if not private.media_path_ok(new.storage_path) or new.storage_path like '%\_thumb.webp' then
    raise exception 'Invalid media path' using errcode = '22023';
  end if;
  if private.media_object_org(new.storage_path) is distinct from new.organization_id
     or private.media_object_site(new.storage_path) is distinct from new.website_id then
    raise exception 'Media path outside the tenant folder' using errcode = '23514';
  end if;

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
  into v_size, v_mime
  from storage.objects o
  where o.bucket_id = 'media' and o.name = new.storage_path and o.archived_at is null
  order by o.created_at desc
  limit 1;
  if v_size is null then
    raise exception 'Upload the file before registering it' using errcode = '22023';
  end if;
  if v_mime is distinct from private.media_mime_for_ext(substring(new.storage_path from '\.([a-z0-9]+)$')) then
    raise exception 'The file type does not match its extension' using errcode = '22023';
  end if;
  new.size_bytes := v_size;
  new.mime_type := v_mime;

  new.thumb_size_bytes := 0;
  if new.thumb_path is not null then
    select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
    into v_thumb_size, v_thumb_mime
    from storage.objects o
    where o.bucket_id = 'media' and o.name = new.thumb_path and o.archived_at is null
    order by o.created_at desc
    limit 1;
    if v_thumb_size is null or v_thumb_mime is distinct from 'image/webp' then
      raise exception 'Invalid thumbnail' using errcode = '22023';
    end if;
    new.thumb_size_bytes := v_thumb_size;
  end if;

  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.media_before_insert() from public, anon, authenticated;

create or replace trigger media_before_insert
  before insert on public.media
  for each row execute function private.media_before_insert();

-- ---------------------------------------------------------------- reads

-- One page of a website's library, newest first (members, viewer and above).
-- Cursor = { created_at, id } of the last row of the previous page.
create or replace function public.media_list(
  p_website_id text,
  p_kind text default null,
  p_search text default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 48
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 48), 1), 100);
  v_search text;
  v_rows jsonb;
  v_count integer;
  v_next jsonb := null;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  select w.organization_id into v_org from public.websites w where w.id = p_website_id;
  if v_org is null or not private.has_org_role(v_org, 'viewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind is not null and p_kind not in ('image', 'video', 'document') then
    raise exception 'Invalid kind' using errcode = '22023';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Invalid cursor' using errcode = '22023';
  end if;
  v_search := nullif(btrim(left(coalesce(p_search, ''), 100)), '');
  if v_search is not null then
    v_search := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with page as (
    select m.id, m.storage_path, m.thumb_path, m.filename, m.mime_type, m.size_bytes,
           m.width, m.height, m.alt_text, m.created_at, m.created_by
    from public.media m
    where m.website_id = p_website_id
      and m.organization_id = v_org
      and (p_kind is null
        or (p_kind = 'image' and m.mime_type like 'image/%')
        or (p_kind = 'video' and m.mime_type like 'video/%')
        or (p_kind = 'document' and m.mime_type not like 'image/%' and m.mime_type not like 'video/%'))
      and (v_search is null or m.filename ilike v_search or m.alt_text ilike v_search)
      and (p_before_created_at is null or (m.created_at, m.id) < (p_before_created_at, p_before_id))
    order by m.created_at desc, m.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count
  from page p;

  if v_count > v_limit then
    v_rows := v_rows - v_limit;
    v_next := jsonb_build_object('created_at', v_rows -> (v_limit - 1) -> 'created_at',
                                 'id', v_rows -> (v_limit - 1) -> 'id');
  end if;
  return jsonb_build_object('rows', v_rows, 'next', v_next);
end;
$$;

-- Totals of one website's library (thumbnails included in bytes).
create or replace function public.media_library_stats(p_website_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_out jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  select w.organization_id into v_org from public.websites w where w.id = p_website_id;
  if v_org is null or not private.has_org_role(v_org, 'viewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'files', count(*),
    'bytes', coalesce(sum(m.size_bytes + m.thumb_size_bytes), 0),
    'images', count(*) filter (where m.mime_type like 'image/%'),
    'videos', count(*) filter (where m.mime_type like 'video/%'),
    'documents', count(*) filter (where m.mime_type not like 'image/%' and m.mime_type not like 'video/%'))
  into v_out
  from public.media m
  where m.website_id = p_website_id and m.organization_id = v_org;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------- usage

-- Storage used by an organization, measured on the stored objects themselves
-- (so a file uploaded without its index row still counts):
--   bytes           every current object: media library (both layouts, thumbnails
--                   included) + organization logos in `brand` (orgs/<org>/)
--   files           objects that are not thumbnails
--   media_bytes / media_files   the media library only
--   thumbnail_bytes             the generated thumbnails
--   brand_bytes                 organization logos
-- Range scans on storage.objects (bucket_id, name COLLATE "C"): fast at any size.
-- Internal version (no caller check) for other SECURITY DEFINER functions, e.g.
-- plan limits; the public one checks membership.
create or replace function private.org_storage_usage(p_org uuid)
returns table (
  bytes bigint,
  files bigint,
  media_bytes bigint,
  media_files bigint,
  thumbnail_bytes bigint,
  brand_bytes bigint
)
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
      )
  )
  select
    coalesce(sum(size), 0)::bigint,
    count(*) filter (where name !~ '_thumb\.webp$'),
    coalesce(sum(size) filter (where bucket_id = 'media'), 0)::bigint,
    count(*) filter (where bucket_id = 'media' and name !~ '_thumb\.webp$'),
    coalesce(sum(size) filter (where bucket_id = 'media' and name ~ '_thumb\.webp$'), 0)::bigint,
    coalesce(sum(size) filter (where bucket_id = 'brand'), 0)::bigint
  from objs;
$$;

create or replace function public.org_storage_usage(p_org uuid)
returns table (
  bytes bigint,
  files bigint,
  media_bytes bigint,
  media_files bigint,
  thumbnail_bytes bigint,
  brand_bytes bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  if p_org is null or not private.has_org_role(p_org, 'viewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from private.org_storage_usage(p_org);
end;
$$;

revoke all on function private.org_storage_usage(uuid) from public, anon, authenticated;
revoke all on function public.media_list(text, text, text, timestamptz, uuid, integer) from public, anon;
revoke all on function public.media_library_stats(text) from public, anon;
revoke all on function public.org_storage_usage(uuid) from public, anon;
grant execute on function public.media_list(text, text, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.media_library_stats(text) to authenticated;
grant execute on function public.org_storage_usage(uuid) to authenticated;
