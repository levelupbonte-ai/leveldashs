-- Plan storage limit (`limits.media_mb`) enforced on media uploads.
--
-- * private.org_storage(org) now reads private.org_storage_usage(org) (the stored
--   objects themselves, 20261026120000_media_storage.sql), so the Billing meter, the
--   usage panel and the upload checks share one number: `bytes` (media library with
--   thumbnails, both layouts, plus organization logos).
-- * Three layers, all raising / refusing on the same rule (used + new > media_mb MB):
--   1. public.media_check_upload(website, bytes): the dashboard asks before uploading
--      and gets `plan_limit_reached` (PT402, detail {"key": "media_mb", "limit", "plan"}).
--   2. Storage insert policy `media_objects_insert`: refuses a new object once the
--      organization is already at or over its limit (the policy cannot know the size
--      of the file being uploaded, so this is the backstop for direct API calls).
--   3. The media index trigger (private.media_before_insert, the registration step):
--      the file and its thumbnail are in Storage by then, with sizes read from Storage,
--      so this is the authoritative check. A refused row leaves the objects to the
--      dashboard, which removes them.
-- * Existing files stay readable and deletable (select / delete policies unchanged);
--   only new uploads are checked. Trusted tooling without a user (scripts/migrate-media.mjs)
--   is not limited, like the role check of the same trigger.

-- @part 1: one storage number ----------------------------------------------------------

create or replace function private.org_storage(p_org uuid)
returns table (bytes bigint, files integer)
language sql
stable
security definer
set search_path = ''
as $$
  select u.bytes, u.media_files::integer from private.org_storage_usage(p_org) u;
$$;

-- Raises plan_limit_reached when the organization's storage plus p_new_bytes goes past
-- media_mb. p_stored: the new bytes are already in Storage (counted in the usage).
create or replace function private.assert_media_quota(p_org uuid, p_new_bytes bigint, p_stored boolean default false)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_used bigint;
  v_new bigint := greatest(coalesce(p_new_bytes, 0), 0);
begin
  if private.plan_limit(p_org, 'media_mb') is null then
    return;
  end if;
  select u.bytes into v_used from private.org_storage_usage(p_org) u;
  v_used := coalesce(v_used, 0);
  if p_stored then
    v_used := greatest(v_used - v_new, 0);
  end if;
  perform private.assert_within_limit(p_org, 'media_mb', v_used / 1048576.0, v_new / 1048576.0);
end;
$$;

-- Storage policy helper: false once the organization of a media object is at or over
-- its plan's storage limit.
create or replace function private.media_quota_open(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.media_object_org(object_name);
  v_limit integer;
  v_used bigint;
begin
  if v_org is null then
    return false;
  end if;
  v_limit := private.plan_limit(v_org, 'media_mb');
  if v_limit is null then
    return true;
  end if;
  select u.bytes into v_used from private.org_storage_usage(v_org) u;
  return coalesce(v_used, 0) < v_limit::bigint * 1048576;
end;
$$;

revoke all on function private.org_storage(uuid) from public, anon, authenticated;
revoke all on function private.assert_media_quota(uuid, bigint, boolean) from public, anon, authenticated;
-- Runs inside the storage policy, as the caller.
revoke all on function private.media_quota_open(text) from public, anon;
grant execute on function private.media_quota_open(text) to authenticated;

-- @part 2: ask before uploading ----------------------------------------------------------

-- Editors and above. p_bytes = the file plus its thumbnail as the browser will send them.
create or replace function public.media_check_upload(p_website_id text, p_bytes bigint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  select w.organization_id into v_org from public.websites w
  where w.id = p_website_id and w.status <> 'archived';
  if v_org is null or not private.has_org_role(v_org, 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_bytes is null or p_bytes < 0 or p_bytes > 104857600 then
    raise exception 'Invalid size' using errcode = '22023';
  end if;
  perform private.assert_media_quota(v_org, p_bytes, false);
end;
$$;

revoke all on function public.media_check_upload(text, bigint) from public, anon;
grant execute on function public.media_check_upload(text, bigint) to authenticated;

-- @part 3: storage policy backstop ---------------------------------------------------------

alter policy media_objects_insert on storage.objects
  with check (bucket_id = 'media' and private.can_upload_media_path(name) and private.media_quota_open(name));

-- @part 4: registration (same trigger as 20261026120000, plus the limit) ------------------

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

  -- Plan storage limit: the file and its thumbnail are already stored (and counted).
  if (select auth.uid()) is not null then
    perform private.assert_media_quota(new.organization_id, v_size + new.thumb_size_bytes, true);
  end if;

  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.media_before_insert() from public, anon, authenticated;
