-- 1. LevelUp Forms, lot 2: new field types (file / photo upload, link, time,
--    star rating, section titles) and more look options.
--    Files go to a PRIVATE bucket (form-uploads): a visitor can only upload to
--    a path the database reserved for one field of one published form (type,
--    size and count checked), and only members of the client's organization
--    can read them (signed links). Nothing is public.
-- 2. Security lockdown: HQ owners can pause every visitor write (forms,
--    bookings, waitlist) for one site or all sites, or put client dashboards in
--    read-only mode. The security watch pauses a single site by itself for 30
--    minutes when it is flooded. HQ itself is never locked (it lifts it).

-- ------------------------------------------------------------ lockdown

create table if not exists private.security_lockdowns (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('public', 'full')),
  website_id text references public.websites (id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 300),
  auto boolean not null default false,
  started_at timestamptz not null default now(),
  started_by uuid references auth.users (id) on delete set null,
  ends_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references auth.users (id) on delete set null,
  check (scope = 'public' or website_id is null)
);
create index if not exists security_lockdowns_active_idx on private.security_lockdowns (scope) where ended_at is null;
revoke all on private.security_lockdowns from public, anon, authenticated;

/** Client dashboards are read-only (HQ decided it). */
create or replace function private.lockdown_full()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.security_lockdowns l
    where l.scope = 'full' and l.ended_at is null and (l.ends_at is null or l.ends_at > now())
  );
$$;

/** Visitor writes are paused for this website (or for every website). */
create or replace function private.lockdown_public(p_website_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.security_lockdowns l
    where l.ended_at is null and (l.ends_at is null or l.ends_at > now())
      and (l.scope = 'full' or l.website_id is null or l.website_id = p_website_id)
  );
$$;
revoke all on function private.lockdown_full(), private.lockdown_public(text) from public, anon;
grant execute on function private.lockdown_full(), private.lockdown_public(text) to authenticated, anon;

-- Every visitor write (submit_form, book_appointment, join_waitlist,
-- public_form_submit) goes through assert_public_write_allowed.
do $do$
declare
  d text := pg_get_functiondef('private.assert_public_write_allowed(text,text,text)'::regprocedure);
  anchor text := 'PERFORM private.assert_origin_allowed(p_website_id);';
begin
  if position('lockdown_public' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'assert_public_write_allowed: unexpected body, not patched';
  end if;
  d := replace(d, anchor, $ins$IF private.lockdown_public(p_website_id) THEN
    RAISE EXCEPTION 'Temporarily paused' USING ERRCODE = 'PT503';
  END IF;
  $ins$ || anchor);
  execute d;
end;
$do$;

-- Read-only dashboards: any check for editor, admin or owner fails while a full
-- lockdown is on (reads that only need a member keep working).
create or replace function private.has_org_role(org_id uuid, min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    exists (
      select 1
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.organization_id = org_id
        and m.user_id = (select auth.uid())
        and o.status <> 'archived'
        and private.role_rank(m.role) >= private.role_rank(min_role)
    )
    or (
      min_role <> 'owner'
      and private.is_platform_admin()
      and exists (select 1 from public.organizations o where o.id = org_id and o.status <> 'archived')
    )
  )
  and (min_role = 'viewer' or not private.lockdown_full());
$$;

-- HQ: start a lockdown (owners, fresh second factor).
create or replace function public.hq_lockdown_start(p_scope text, p_website_id text, p_minutes integer, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_reason text := private.check_text(p_reason, 300, 'reason');
begin
  perform private.hq_assert('staff.manage');
  perform private.hq_assert_fresh_mfa();
  if p_scope not in ('public', 'full') then
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  if p_scope = 'full' and p_website_id is not null then
    raise exception 'read-only mode covers every client' using errcode = '22023';
  end if;
  if p_website_id is not null and not exists (select 1 from public.websites w where w.id = p_website_id) then
    raise exception 'Unknown website' using errcode = 'PT404';
  end if;
  if p_minutes is not null and (p_minutes < 5 or p_minutes > 10080) then
    raise exception 'duration must be 5 minutes to 7 days' using errcode = '22023';
  end if;
  if coalesce(char_length(v_reason), 0) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  insert into private.security_lockdowns (scope, website_id, reason, started_by, ends_at)
  values (p_scope, p_website_id, v_reason, (select auth.uid()),
          case when p_minutes is null then null else now() + make_interval(mins => p_minutes) end)
  returning id into v_id;
  perform private.hq_log('security.lockdown_started', 'lockdown', v_id::text,
    jsonb_build_object('scope', p_scope, 'website_id', p_website_id, 'minutes', p_minutes, 'reason', v_reason));
  perform private.security_alert('lockdown', 'high',
    case when p_scope = 'full' then 'Client dashboards set to read-only' else 'Visitor writes paused' end,
    jsonb_build_object('scope', p_scope, 'website', coalesce(p_website_id, 'all'), 'reason', v_reason),
    'lockdown:' || v_id::text);
  return v_id;
end;
$$;
revoke all on function public.hq_lockdown_start(text, text, integer, text) from public, anon;
grant execute on function public.hq_lockdown_start(text, text, integer, text) to authenticated;

create or replace function public.hq_lockdown_end(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.hq_assert('staff.manage');
  update private.security_lockdowns
     set ended_at = now(), ended_by = (select auth.uid())
   where id = p_id and ended_at is null;
  if not found then
    raise exception 'Unknown lockdown' using errcode = 'PT404';
  end if;
  perform private.hq_log('security.lockdown_ended', 'lockdown', p_id::text, '{}'::jsonb);
end;
$$;
revoke all on function public.hq_lockdown_end(bigint) from public, anon;
grant execute on function public.hq_lockdown_end(bigint) to authenticated;

-- HQ > Security also lists the active lockdowns.
do $do$
declare
  d text := pg_get_functiondef('public.hq_security_alerts(integer,integer,integer)'::regprocedure);
  anchor text := $a$    'emailing', $a$;
begin
  if position('lockdowns' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'hq_security_alerts: unexpected body, not patched';
  end if;
  d := replace(d, anchor, $ins$    'lockdowns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'scope', l.scope, 'website_id', l.website_id,
               'website', (select w.name from public.websites w where w.id = l.website_id),
               'reason', l.reason, 'auto', l.auto, 'started_at', l.started_at, 'ends_at', l.ends_at)
             order by l.started_at desc)
      from private.security_lockdowns l
      where l.ended_at is null and (l.ends_at is null or l.ends_at > now())), '[]'::jsonb),
$ins$ || anchor);
  execute d;
end;
$do$;

-- The watch pauses one site by itself when visitors' writes flood it
-- (150 in 15 minutes), for 30 minutes, and says so in the alert.
do $do$
declare
  d text := pg_get_functiondef('private.security_scan()'::regprocedure);
  anchor text := $a$  delete from private.security_alerts where created_at < now() - interval '180 days';$a$;
begin
  if position('security_lockdowns' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'security_scan: unexpected body, not patched';
  end if;
  d := replace(d, anchor, $ins$  for r in
    select w.id, w.name, (
        (select count(*) from public.form_submissions s where s.website_id = w.id and s.created_at > now() - interval '15 minutes')
      + (select count(*) from public.appointments a where a.website_id = w.id and a.created_at > now() - interval '15 minutes')
      + (select count(*) from public.waitlist_entries q where q.website_id = w.id and q.joined_at > now() - interval '15 minutes')
    ) as writes
    from public.websites w
    where w.status = 'active'
  loop
    if r.writes >= 150 and not private.lockdown_public(r.id) then
      insert into private.security_lockdowns (scope, website_id, reason, auto, ends_at)
      values ('public', r.id, 'Automatic: ' || r.writes || ' visitor writes in 15 minutes', true, now() + interval '30 minutes');
      if private.security_alert('auto_lockdown', 'high', 'Site paused automatically: ' || r.name,
           jsonb_build_object('website', r.id, 'writes_15min', r.writes, 'paused_minutes', 30),
           'auto_lockdown:' || r.id) then
        v_new := v_new + 1;
      end if;
    end if;
  end loop;

  -- Old form upload bookings (never used) are forgotten after 7 days.
  delete from private.form_uploads where submission_id is null and created_at < now() - interval '7 days';

$ins$ || anchor);
  execute d;
end;
$do$;

-- ------------------------------------------------------------ form uploads

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('form-uploads', 'form-uploads', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists private.form_uploads (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.site_forms (id) on delete cascade,
  field_id text not null,
  path text not null unique,
  file_name text not null,
  mime text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  submission_id uuid references public.form_submissions (id) on delete set null
);
create index if not exists form_uploads_form_idx on private.form_uploads (form_id, created_at desc);
revoke all on private.form_uploads from public, anon, authenticated;

/** A visitor may upload to this path: reserved, not used, not expired. */
create or replace function private.form_upload_open(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.form_uploads u
    where u.path = p_path and u.submission_id is null and u.expires_at > now()
  );
$$;

/** The signed-in user belongs to the organization that owns this uploaded file. */
create or replace function private.form_upload_viewer(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.form_uploads u join public.site_forms f on f.id = u.form_id
    where u.path = p_path and u.submission_id is not null and private.has_org_role(f.organization_id, 'viewer')
  );
$$;
revoke all on function private.form_upload_open(text), private.form_upload_viewer(text) from public;
grant execute on function private.form_upload_open(text) to anon, authenticated;
grant execute on function private.form_upload_viewer(text) to authenticated;

drop policy if exists form_uploads_visitor_insert on storage.objects;
create policy form_uploads_visitor_insert on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'form-uploads' and private.form_upload_open(name));
drop policy if exists form_uploads_member_read on storage.objects;
create policy form_uploads_member_read on storage.objects
  for select to authenticated
  using (bucket_id = 'form-uploads' and private.form_upload_viewer(name));

-- ------------------------------------------------------------ form fields v2

create or replace function private.form_clean_fields(p_fields jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  f jsonb;
  v_out jsonb := '[]'::jsonb;
  v_ids text[] := '{}';
  v_maps text[] := '{}';
  v_id text;
  v_type text;
  v_map text;
  v_options jsonb;
  o jsonb;
  v_files integer := 0;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'fields must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_fields) > 40 then
    raise exception 'At most 40 fields' using errcode = '22023';
  end if;
  for f in select * from jsonb_array_elements(p_fields) loop
    if jsonb_typeof(f) <> 'object' then
      raise exception 'invalid field' using errcode = '22023';
    end if;
    v_id := f ->> 'id';
    if v_id is null or v_id !~ '^[a-z][a-z0-9_]{0,39}$' or v_id = any (v_ids) then
      raise exception 'invalid or duplicate field id' using errcode = '22023';
    end if;
    v_ids := v_ids || v_id;
    v_type := f ->> 'type';
    if v_type is null or v_type not in ('text', 'email', 'phone', 'textarea', 'select', 'radio', 'checkbox',
                                        'multiselect', 'date', 'number', 'url', 'time', 'rating', 'file', 'section') then
      raise exception 'invalid field type' using errcode = '22023';
    end if;
    if v_type = 'file' then
      v_files := v_files + 1;
      if v_files > 3 then
        raise exception 'At most 3 upload fields' using errcode = '22023';
      end if;
    end if;
    v_map := nullif(f ->> 'maps', '');
    if v_map is not null then
      if v_map not in ('name', 'email', 'phone', 'company', 'message') or v_map = any (v_maps) then
        raise exception 'invalid field mapping' using errcode = '22023';
      end if;
      if (v_map = 'email' and v_type <> 'email') or (v_map = 'phone' and v_type <> 'phone')
         or (v_map in ('name', 'company') and v_type <> 'text')
         or (v_map = 'message' and v_type not in ('text', 'textarea')) then
        raise exception 'field mapping does not match its type' using errcode = '22023';
      end if;
      v_maps := v_maps || v_map;
    end if;
    v_options := '[]'::jsonb;
    if v_type in ('select', 'radio', 'multiselect') then
      if jsonb_typeof(f -> 'options') <> 'array' or jsonb_array_length(f -> 'options') not between 1 and 30 then
        raise exception 'a choice field needs 1 to 30 options' using errcode = '22023';
      end if;
      for o in select * from jsonb_array_elements(f -> 'options') loop
        if private.form_line(o, 80, 'option') is null then
          raise exception 'invalid option' using errcode = '22023';
        end if;
        if v_options @> jsonb_build_array(private.form_line(o, 80, 'option')) then
          raise exception 'duplicate option' using errcode = '22023';
        end if;
        v_options := v_options || jsonb_build_array(private.form_line(o, 80, 'option'));
      end loop;
    end if;
    if private.form_line(f -> 'label', 120, 'label') is null then
      raise exception 'every field needs a label' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id', v_id,
      'type', v_type,
      'label', private.form_line(f -> 'label', 120, 'label'),
      'placeholder', case when v_type not in ('section', 'file', 'rating', 'checkbox')
                          then private.form_line(f -> 'placeholder', 160, 'placeholder') end,
      'help', case when v_type = 'section' and jsonb_typeof(f -> 'help') = 'string'
                   then private.check_text(f ->> 'help', 1000, 'text', true)
                   else private.form_line(f -> 'help', 240, 'help') end,
      'required', case when v_type = 'section' then false else coalesce((f ->> 'required')::boolean, false) end,
      'maps', v_map,
      'options', case when v_type in ('select', 'radio', 'multiselect') then v_options end,
      'accept', case when v_type = 'file' then
                  case when f ->> 'accept' in ('image', 'document') then f ->> 'accept' else 'any' end end,
      'max_files', case when v_type = 'file' then
                     least(greatest(coalesce((f ->> 'max_files')::integer, 1), 1), 5) end,
      'max', case when v_type = 'rating' then
               least(greatest(coalesce((f ->> 'max')::integer, 5), 3), 10) end,
      'width', case when f ->> 'width' = 'half' and v_type <> 'section' then 'half' end
    )));
  end loop;
  return v_out;
end;
$$;

create or replace function private.form_clean_settings(p_settings jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  s jsonb := coalesce(p_settings, '{}'::jsonb);
  v_accent text := s ->> 'accent';
  v_redirect text := nullif(btrim(coalesce(s ->> 'redirect_url', '')), '');
  v_cover text := nullif(btrim(coalesce(s ->> 'cover_url', '')), '');
begin
  if jsonb_typeof(s) <> 'object' then
    raise exception 'invalid settings' using errcode = '22023';
  end if;
  if v_accent is not null and v_accent !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'invalid color' using errcode = '22023';
  end if;
  if v_redirect is not null and (v_redirect !~ '^https://[^[:space:]<>"''`]+$' or char_length(v_redirect) > 500) then
    raise exception 'invalid redirect address' using errcode = '22023';
  end if;
  if v_cover is not null and (v_cover !~ '^https://[^[:space:]<>"''`]+$' or char_length(v_cover) > 1000) then
    raise exception 'invalid cover image address' using errcode = '22023';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'title', private.form_line(s -> 'title', 120, 'title'),
    'description', case when jsonb_typeof(s -> 'description') = 'string'
                        then private.check_text(s ->> 'description', 600, 'description', true) end,
    'submit_label', private.form_line(s -> 'submit_label', 40, 'button'),
    'success_title', private.form_line(s -> 'success_title', 120, 'success title'),
    'success_message', case when jsonb_typeof(s -> 'success_message') = 'string'
                            then private.check_text(s ->> 'success_message', 600, 'success message', true) end,
    'consent_text', private.form_line(s -> 'consent_text', 300, 'consent'),
    'redirect_url', v_redirect,
    'cover_url', v_cover,
    'accent', lower(v_accent),
    'mode', case when s ->> 'mode' in ('light', 'dark') then s ->> 'mode' end,
    'radius', case when s ->> 'radius' in ('none', 'md', 'lg') then s ->> 'radius' end,
    'font', case when s ->> 'font' in ('sans', 'serif', 'mono') then s ->> 'font' end,
    'layout', case when s ->> 'layout' in ('card', 'plain') then s ->> 'layout' end,
    'width', case when s ->> 'width' in ('narrow', 'wide') then s ->> 'width' end,
    'button', case when s ->> 'button' in ('solid', 'outline', 'pill') then s ->> 'button' end,
    'show_logo', case when jsonb_typeof(s -> 'show_logo') = 'boolean' then (s -> 'show_logo') end
  ));
end;
$$;

-- A visitor books an upload for a file field (before sending the form).
create or replace function public.public_form_upload_reserve(
  p_public_id text, p_field_id text, p_name text, p_mime text, p_size integer, p_subject text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.site_forms;
  v_field jsonb;
  v_accept text;
  v_ext text;
  v_path text;
  v_name text := left(regexp_replace(coalesce(p_name, ''), '[^[:alnum:] ._()-]', '', 'g'), 120);
begin
  select * into v_form from public.site_forms x where x.public_id = p_public_id and x.status = 'published';
  if v_form.id is null or not private.is_website_live(v_form.website_id) then
    raise exception 'Form not found' using errcode = 'PT404';
  end if;
  if private.lockdown_public(v_form.website_id) then
    raise exception 'Temporarily paused' using errcode = 'PT503';
  end if;
  select e into v_field from jsonb_array_elements(v_form.fields) e
   where e ->> 'id' = p_field_id and e ->> 'type' = 'file';
  if v_field is null then
    raise exception 'Unknown field' using errcode = '22023', hint = p_field_id;
  end if;
  v_accept := coalesce(v_field ->> 'accept', 'any');
  v_ext := case p_mime
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/gif' then 'gif'
    when 'application/pdf' then 'pdf' when 'text/plain' then 'txt'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
  end;
  if v_ext is null
     or (v_accept = 'image' and p_mime not like 'image/%')
     or (v_accept = 'document' and p_mime like 'image/%') then
    raise exception 'File type not allowed' using errcode = '22023', hint = p_field_id;
  end if;
  if p_size is null or p_size < 1 or p_size > 10485760 then
    raise exception 'File too large' using errcode = '22023', hint = p_field_id;
  end if;
  perform private.hit_rate_limit('form_upload_form', v_form.id::text, 300, interval '1 day');
  if nullif(p_subject, '') is not null then
    perform private.hit_rate_limit('form_upload', v_form.public_id || ':' || left(p_subject, 80), 20, interval '1 hour');
  end if;
  v_path := v_form.id::text || '/' || gen_random_uuid()::text || '.' || v_ext;
  insert into private.form_uploads (form_id, field_id, path, file_name, mime, size_bytes)
  values (v_form.id, p_field_id, v_path, coalesce(nullif(v_name, ''), 'file.' || v_ext), p_mime, p_size);
  return jsonb_build_object('path', v_path, 'bucket', 'form-uploads');
end;
$$;
revoke all on function public.public_form_upload_reserve(text, text, text, text, integer, text) from public;
grant execute on function public.public_form_upload_reserve(text, text, text, text, integer, text) to anon, authenticated;

create or replace function public.public_form_submit(p_public_id text, p_values jsonb, p_subject text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.site_forms;
  f jsonb;
  v jsonb;
  p jsonb;
  v_text text;
  v_cols jsonb := '{}'::jsonb;
  v_data jsonb := '{}'::jsonb;
  v_files jsonb;
  v_paths text[] := '{}';
  v_ids text[];
  v_key text;
  v_ticket text;
  v_submission uuid;
  v_upload private.form_uploads;
begin
  if p_public_id is null or p_public_id !~ '^f[a-z0-9]{10}$' then
    raise exception 'Form not found' using errcode = 'PT404';
  end if;
  select * into v_form from public.site_forms x where x.public_id = p_public_id and x.status = 'published';
  if v_form.id is null or not private.is_website_live(v_form.website_id) then
    raise exception 'Form not found' using errcode = 'PT404';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' or pg_column_size(p_values) > 32768 then
    raise exception 'Invalid answers' using errcode = '22023';
  end if;
  select coalesce(array_agg(e ->> 'id'), '{}') into v_ids
  from jsonb_array_elements(v_form.fields) e where e ->> 'type' <> 'section';
  for v_key in select jsonb_object_keys(p_values) loop
    if not (v_key = any (v_ids)) and v_key <> '_consent' then
      raise exception 'Unknown field' using errcode = '22023';
    end if;
  end loop;
  if v_form.settings ? 'consent_text' and coalesce((p_values ->> '_consent')::boolean, false) is not true then
    raise exception 'Consent is required' using errcode = '22023', hint = '_consent';
  end if;

  for f in select * from jsonb_array_elements(v_form.fields) loop
    if f ->> 'type' = 'section' then
      continue;
    end if;
    v := p_values -> (f ->> 'id');
    v_text := null;
    if v is null or jsonb_typeof(v) = 'null'
       or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
       or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0)
       or (f ->> 'type' = 'checkbox' and v = 'false'::jsonb) then
      if (f ->> 'required')::boolean then
        raise exception 'A required field is empty' using errcode = '22023', hint = f ->> 'id';
      end if;
      continue;
    end if;
    case f ->> 'type'
      when 'text' then
        v_text := private.form_line(v, case f ->> 'maps' when 'name' then 120 when 'company' then 160 else 200 end,
                                    f ->> 'id');
      when 'textarea' then
        if jsonb_typeof(v) <> 'string' then raise exception 'Invalid answer' using errcode = '22023', hint = f ->> 'id'; end if;
        v_text := private.check_text(v #>> '{}', 5000, f ->> 'id', true);
      when 'email' then
        v_text := lower(private.form_line(v, 254, f ->> 'id'));
        if v_text is null or not private.is_valid_email(v_text) then
          raise exception 'Invalid email address' using errcode = '22023', hint = f ->> 'id';
        end if;
      when 'phone' then
        v_text := private.form_line(v, 40, f ->> 'id');
        if v_text is null or not private.is_valid_phone(v_text) then
          raise exception 'Invalid phone number' using errcode = '22023', hint = f ->> 'id';
        end if;
      when 'url' then
        v_text := private.form_line(v, 500, f ->> 'id');
        if v_text is null or v_text !~* '^https?://[^[:space:]<>"''`]+\.[^[:space:]<>"''`]+$' then
          raise exception 'Invalid link' using errcode = '22023', hint = f ->> 'id';
        end if;
      when 'time' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
          raise exception 'Invalid time' using errcode = '22023', hint = f ->> 'id';
        end if;
        v_text := v #>> '{}';
      when 'select', 'radio' then
        if jsonb_typeof(v) <> 'string' or not ((f -> 'options') @> jsonb_build_array(v)) then
          raise exception 'Invalid choice' using errcode = '22023', hint = f ->> 'id';
        end if;
        v_text := v #>> '{}';
      when 'multiselect' then
        if jsonb_typeof(v) <> 'array' or not ((f -> 'options') @> v) or jsonb_array_length(v) > 30 then
          raise exception 'Invalid choice' using errcode = '22023', hint = f ->> 'id';
        end if;
        v_data := v_data || jsonb_build_object(f ->> 'id', v);
        continue;
      when 'checkbox' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception 'Invalid answer' using errcode = '22023', hint = f ->> 'id';
        end if;
        v_data := v_data || jsonb_build_object(f ->> 'id', v);
        continue;
      when 'rating' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> round((v #>> '{}')::numeric)
           or (v #>> '{}')::integer not between 1 and coalesce((f ->> 'max')::integer, 5) then
          raise exception 'Invalid rating' using errcode = '22023', hint = f ->> 'id';
        end if;
        v_data := v_data || jsonb_build_object(f ->> 'id', v);
        continue;
      when 'date' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'Invalid date' using errcode = '22023', hint = f ->> 'id';
        end if;
        begin
          perform (v #>> '{}')::date;
        exception when others then
          raise exception 'Invalid date' using errcode = '22023', hint = f ->> 'id';
        end;
        v_text := v #>> '{}';
      when 'number' then
        if jsonb_typeof(v) <> 'number' or abs((v #>> '{}')::numeric) > 1000000000 then
          raise exception 'Invalid number' using errcode = '22023', hint = f ->> 'id';
        end if;
        v_data := v_data || jsonb_build_object(f ->> 'id', v);
        continue;
      when 'file' then
        -- Paths booked for this very field, uploaded, not used by another answer.
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > coalesce((f ->> 'max_files')::integer, 1) then
          raise exception 'Invalid files' using errcode = '22023', hint = f ->> 'id';
        end if;
        v_files := '[]'::jsonb;
        for p in select * from jsonb_array_elements(v) loop
          select * into v_upload from private.form_uploads u
           where u.path = (p #>> '{}') and u.form_id = v_form.id and u.field_id = f ->> 'id'
             and u.submission_id is null
             and exists (select 1 from storage.objects o where o.bucket_id = 'form-uploads' and o.name = u.path);
          if v_upload.id is null or jsonb_typeof(p) <> 'string' or (p #>> '{}') = any (v_paths) then
            raise exception 'Invalid files' using errcode = '22023', hint = f ->> 'id';
          end if;
          v_paths := v_paths || v_upload.path;
          v_files := v_files || jsonb_build_array(jsonb_build_object(
            'file', v_upload.path, 'name', v_upload.file_name, 'mime', v_upload.mime, 'size', v_upload.size_bytes));
        end loop;
        v_data := v_data || jsonb_build_object(f ->> 'id', v_files);
        continue;
    end case;
    if v_text is null then
      if (f ->> 'required')::boolean then
        raise exception 'A required field is empty' using errcode = '22023', hint = f ->> 'id';
      end if;
      continue;
    end if;
    if f ? 'maps' then
      v_cols := v_cols || jsonb_build_object(f ->> 'maps', v_text);
    else
      v_data := v_data || jsonb_build_object(f ->> 'id', v_text);
    end if;
  end loop;

  perform private.assert_public_write_allowed(v_form.website_id, v_cols ->> 'email', v_cols ->> 'phone');
  if nullif(p_subject, '') is not null then
    perform private.hit_rate_limit('public_form', v_form.public_id || ':' || left(p_subject, 80), 10, interval '1 hour');
  end if;

  v_ticket := private.generate_ticket_code(private.ticket_prefix(v_form.website_id));
  insert into public.form_submissions (website_id, organization_id, form_type, ticket_code, name, email, phone,
                                       company, message, data, source, site_form_id)
  values (v_form.website_id, v_form.organization_id, v_form.form_type, v_ticket,
          v_cols ->> 'name', v_cols ->> 'email', v_cols ->> 'phone', v_cols ->> 'company', v_cols ->> 'message',
          v_data, 'LevelUp form: ' || left(v_form.name, 60), v_form.id)
  returning id into v_submission;
  if cardinality(v_paths) > 0 then
    update private.form_uploads set submission_id = v_submission where path = any (v_paths);
  end if;
  return jsonb_build_object('ticket_code', v_ticket);
end;
$$;
revoke all on function public.public_form_submit(text, jsonb, text) from public;
grant execute on function public.public_form_submit(text, jsonb, text) to anon, authenticated;
