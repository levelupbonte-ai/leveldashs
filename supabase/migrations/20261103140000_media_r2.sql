-- Media library on Cloudflare R2 (bucket "levelup-media", public at
-- https://media.levelup-ecosystem.com). Supabase Storage stays for the files
-- already there and for brand logos.
--
-- Flow, no secret ever in the browser:
-- 1. media_r2_reserve (signed-in editor): checks the role, the type, the size
--    and the plan quota, and books a path org/<org>/site/<site>/<yyyy>/<mm>/<uuid>.<ext>
--    for 15 minutes. The booking counts in the quota right away.
-- 2. The dashboard server signs a PUT URL for exactly that path, type and
--    size (R2 refuses anything else) with the R2 key it alone holds.
-- 3. The browser uploads to R2, then inserts the media row (bucket 'r2'). The
--    insert trigger only accepts an r2 row that matches an unused booking of
--    the same user, and takes the sizes from the booking (never from the client).
-- 4. Deleting an r2 file goes through media_r2_delete, called by the dashboard
--    server, which then deletes the objects in R2. Plain deletes of r2 rows are
--    refused so no object is left behind uncounted.
-- Unused bookings keep counting; after an hour the next booking of the same
-- organization forgets them and returns their paths ("expired") so the
-- dashboard server deletes those objects. No shared secret anywhere.

create table if not exists private.media_r2_pending (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id text not null,
  storage_path text not null unique,
  thumb_path text,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  thumb_size_bytes bigint not null default 0 check (thumb_size_bytes >= 0 and thumb_size_bytes <= 2097152),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz
);
create index if not exists media_r2_pending_org_idx on private.media_r2_pending (organization_id) where used_at is null;
revoke all on private.media_r2_pending from public, anon, authenticated;

-- Storage used by an organization: Supabase Storage objects (as before) plus
-- r2 media rows and r2 bookings not used yet.
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

create or replace function public.media_r2_reserve(
  p_website_id text,
  p_ext text,
  p_mime text,
  p_bytes bigint,
  p_thumb_bytes bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_path text;
  v_thumb text;
  v_id uuid;
  v_expired jsonb;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  select w.organization_id into v_org from public.websites w where w.id = p_website_id;
  if v_org is null or not private.has_org_role(v_org, 'editor') or private.org_contract_locked(v_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ext is null or private.media_mime_for_ext(p_ext) is distinct from p_mime then
    raise exception 'The file type does not match its extension' using errcode = '22023';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 10485760
     or coalesce(p_thumb_bytes, 0) < 0 or coalesce(p_thumb_bytes, 0) > 2097152
     or (coalesce(p_thumb_bytes, 0) > 0 and p_mime not like 'image/%') then
    raise exception 'Invalid size' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('media_r2_reserve', v_uid::text, 300, interval '1 hour');

  -- The organization's bookings unused for over an hour: forgotten here, their
  -- objects deleted in R2 by the caller (the dashboard server).
  with gone as (
    delete from private.media_r2_pending p
    where p.id in (
      select id from private.media_r2_pending
      where organization_id = v_org and used_at is null and created_at < now() - interval '1 hour'
      order by created_at limit 20
    )
    returning p.storage_path, p.thumb_path
  )
  select coalesce(jsonb_agg(jsonb_build_object('path', storage_path, 'thumb_path', thumb_path)), '[]'::jsonb)
  into v_expired from gone;
  delete from private.media_r2_pending
  where organization_id = v_org and used_at is not null and used_at < now() - interval '30 days';

  perform private.assert_media_quota(v_org, p_bytes + coalesce(p_thumb_bytes, 0), false);

  v_path := 'org/' || v_org::text || '/site/' || p_website_id || '/'
            || to_char(now() at time zone 'utc', 'YYYY/MM') || '/' || gen_random_uuid()::text || '.' || p_ext;
  if coalesce(p_thumb_bytes, 0) > 0 then
    v_thumb := regexp_replace(v_path, '\.[a-z0-9]+$', '_thumb.webp');
  end if;
  insert into private.media_r2_pending (organization_id, website_id, storage_path, thumb_path, mime_type,
                                        size_bytes, thumb_size_bytes, created_by)
  values (v_org, p_website_id, v_path, v_thumb, p_mime, p_bytes, coalesce(p_thumb_bytes, 0), v_uid)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'path', v_path, 'thumb_path', v_thumb, 'expired', v_expired);
end;
$$;
revoke all on function public.media_r2_reserve(text, text, text, bigint, bigint) from public, anon;
grant execute on function public.media_r2_reserve(text, text, text, bigint, bigint) to authenticated;

-- Removes an r2 media row (editor of its organization) and returns the paths
-- to delete in R2. Called by the dashboard server, which then deletes them.
create or replace function public.media_r2_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.media;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  select * into v_row from public.media where id = p_id and bucket = 'r2';
  if v_row.id is null or not private.has_org_role(v_row.organization_id, 'editor')
     or private.org_contract_locked(v_row.organization_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.media where id = p_id;
  return jsonb_build_object('path', v_row.storage_path, 'thumb_path', v_row.thumb_path);
end;
$$;
revoke all on function public.media_r2_delete(uuid) from public, anon;
grant execute on function public.media_r2_delete(uuid) to authenticated;

-- Insert trigger: r2 rows must match an unused booking of the same user.
do $do$
declare
  d text := pg_get_functiondef('private.media_before_insert()'::regprocedure);
  anchor text := $a$  if new.bucket is distinct from 'media' then$a$;
begin
  if position('media_r2_pending' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'media_before_insert: unexpected body, not patched';
  end if;
  d := replace(d, anchor, $ins$  if new.bucket = 'r2' then
    declare
      v_book private.media_r2_pending;
    begin
      select * into v_book from private.media_r2_pending b
      where b.storage_path = new.storage_path and b.used_at is null and b.expires_at > now()
      for update;
      if v_book.id is null or v_book.created_by is distinct from (select auth.uid())
         or v_book.organization_id is distinct from new.organization_id
         or v_book.website_id is distinct from new.website_id
         or v_book.thumb_path is distinct from new.thumb_path then
        raise exception 'Upload the file before registering it' using errcode = '22023';
      end if;
      update private.media_r2_pending set used_at = now() where id = v_book.id;
      new.size_bytes := v_book.size_bytes;
      new.thumb_size_bytes := v_book.thumb_size_bytes;
      new.mime_type := v_book.mime_type;
      new.created_at := now();
      new.updated_at := now();
      return new;
    end;
  end if;
$ins$ || anchor);
  execute d;
end;
$do$;

-- No plain delete of r2 rows (media_r2_delete removes the objects too).
drop policy if exists media_r2_no_plain_delete on public.media;
create policy media_r2_no_plain_delete on public.media as restrictive
  for delete to authenticated using (bucket <> 'r2');

-- The library lists the bucket of each file (to build its URL).
do $do$
declare
  d text := pg_get_functiondef('public.media_list(text,text,text,timestamptz,uuid,integer)'::regprocedure);
begin
  if position('m.bucket' in d) > 0 then
    return;
  end if;
  if position('select m.id, m.storage_path,' in d) = 0 then
    raise exception 'media_list: unexpected body, not patched';
  end if;
  d := replace(d, 'select m.id, m.storage_path,', 'select m.id, m.bucket, m.storage_path,');
  execute d;
end;
$do$;

-- Library stats: the organization's storage used and its plan limit
-- (null = unlimited), for the "X of Y" bar of the media library.
do $do$
declare
  d text := pg_get_functiondef('public.media_library_stats(text)'::regprocedure);
begin
  if position('limit_bytes' in d) > 0 then
    return;
  end if;
  if position('  return v_out;' in d) = 0 then
    raise exception 'media_library_stats: unexpected body, not patched';
  end if;
  d := replace(d, '  return v_out;', $ins$  v_out := v_out || jsonb_build_object(
    'org_bytes', (select u.bytes from private.org_storage_usage(v_org) u),
    'limit_bytes', (select private.plan_limit(v_org, 'media_mb')::bigint * 1048576));
  return v_out;$ins$);
  execute d;
end;
$do$;
