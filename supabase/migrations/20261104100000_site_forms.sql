-- LevelUp Forms (lot 1): forms a client builds in the dashboard and LevelUp
-- hosts on its own page (like a payment page), so a site needs no form code.
--
-- * site_forms: one row per form (fields + look, as validated JSON).
-- * Dashboard (editor+): site_form_save / site_form_archive; reads through RLS.
-- * Public (anon): public_form_get (published forms only, no internal data) and
--   public_form_submit, which checks every value against the stored fields:
--   unknown fields, wrong types, values outside the choices, HTML and oversized
--   text are refused. Answers land in form_submissions (Requests page).

create table if not exists public.site_forms (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique check (public_id ~ '^f[a-z0-9]{10}$'),
  website_id text not null references public.websites (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  form_type text not null default 'contact' check (form_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists site_forms_site_idx on public.site_forms (website_id, updated_at desc);
alter table public.site_forms enable row level security;
revoke all on public.site_forms from public, anon, authenticated;
grant select on public.site_forms to authenticated;
drop policy if exists site_forms_member_read on public.site_forms;
create policy site_forms_member_read on public.site_forms
  for select to authenticated
  using (private.has_org_role(organization_id, 'viewer'));

alter table public.form_submissions
  add column if not exists site_form_id uuid references public.site_forms (id) on delete set null;
create index if not exists form_submissions_site_form_idx
  on public.form_submissions (site_form_id, created_at desc) where site_form_id is not null;

-- ------------------------------------------------------------ validation

/** One-line text: cleaned, at most p_max characters, no HTML (else an error). */
create or replace function private.form_line(p_value jsonb, p_max integer, p_what text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'string' then null
    else private.check_text(p_value #>> '{}', p_max, p_what)
  end;
$$;

/** A form's fields, checked and normalised (raises 22023 on anything invalid). */
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
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'fields must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_fields) > 25 then
    raise exception 'At most 25 fields' using errcode = '22023';
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
    if v_type is null or v_type not in ('text', 'email', 'phone', 'textarea', 'select', 'radio',
                                        'checkbox', 'multiselect', 'date', 'number') then
      raise exception 'invalid field type' using errcode = '22023';
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
      'placeholder', private.form_line(f -> 'placeholder', 160, 'placeholder'),
      'help', private.form_line(f -> 'help', 240, 'help'),
      'required', coalesce((f ->> 'required')::boolean, false),
      'maps', v_map,
      'options', case when v_type in ('select', 'radio', 'multiselect') then v_options end,
      'width', case when f ->> 'width' = 'half' then 'half' end
    )));
  end loop;
  return v_out;
end;
$$;

/** A form's look and texts, checked and normalised. */
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
    'accent', lower(v_accent),
    'mode', case when s ->> 'mode' in ('light', 'dark') then s ->> 'mode' end,
    'radius', case when s ->> 'radius' in ('none', 'md', 'lg') then s ->> 'radius' end,
    'show_logo', case when jsonb_typeof(s -> 'show_logo') = 'boolean' then (s -> 'show_logo') end
  ));
end;
$$;

-- ------------------------------------------------------------ dashboard

create or replace function public.site_form_save(
  p_website_id text, p_form_id uuid, p_name text, p_form_type text, p_status text,
  p_fields jsonb, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_row public.site_forms;
  v_fields jsonb := private.form_clean_fields(p_fields);
  v_settings jsonb := private.form_clean_settings(p_settings);
  v_name text := private.check_text(p_name, 120, 'name');
  v_status text := coalesce(nullif(p_status, ''), 'draft');
begin
  select w.organization_id into v_org from public.websites w where w.id = p_website_id;
  if v_uid is null or v_org is null or not private.has_org_role(v_org, 'editor') then
    raise exception 'Not allowed' using errcode = 'PT403';
  end if;
  if v_name is null then
    raise exception 'A form needs a name' using errcode = '22023';
  end if;
  if v_status not in ('draft', 'published') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if coalesce(p_form_type, '') !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'invalid form type' using errcode = '22023';
  end if;
  if v_status = 'published' and jsonb_array_length(v_fields) = 0 then
    raise exception 'Add at least one field before publishing' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('site_form_save', v_uid::text, 120, interval '1 hour');

  if p_form_id is null then
    if (select count(*) from public.site_forms f where f.website_id = p_website_id and f.status <> 'archived') >= 50 then
      raise exception 'At most 50 forms per website' using errcode = 'PT402';
    end if;
    insert into public.site_forms (public_id, website_id, organization_id, name, form_type, status,
                                   fields, settings, created_by, updated_by)
    values ('f' || substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10),
            p_website_id, v_org, v_name, p_form_type, v_status, v_fields, v_settings, v_uid, v_uid)
    returning * into v_row;
    perform private.site_audit(p_website_id, v_org, 'forms.created', v_row.id::text,
      jsonb_build_object('label', v_name));
  else
    update public.site_forms f
       set name = v_name, form_type = p_form_type, status = v_status, fields = v_fields,
           settings = v_settings, updated_by = v_uid, updated_at = now()
     where f.id = p_form_id and f.website_id = p_website_id and f.status <> 'archived'
    returning * into v_row;
    if v_row.id is null then
      raise exception 'Form not found' using errcode = 'PT404';
    end if;
    perform private.site_audit(p_website_id, v_org,
      case when v_status = 'published' then 'forms.published' else 'forms.updated' end,
      v_row.id::text, jsonb_build_object('label', v_name));
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.site_form_save(text, uuid, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.site_form_save(text, uuid, text, text, text, jsonb, jsonb) to authenticated;

create or replace function public.site_form_archive(p_form_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.site_forms;
begin
  select * into v_row from public.site_forms f where f.id = p_form_id;
  if v_row.id is null or not private.has_org_role(v_row.organization_id, 'editor') then
    raise exception 'Form not found' using errcode = 'PT404';
  end if;
  update public.site_forms set status = 'archived', updated_by = (select auth.uid()), updated_at = now()
   where id = p_form_id;
  perform private.site_audit(v_row.website_id, v_row.organization_id, 'forms.archived', v_row.id::text,
    jsonb_build_object('label', v_row.name));
end;
$$;
revoke all on function public.site_form_archive(uuid) from public, anon;
grant execute on function public.site_form_archive(uuid) to authenticated;

-- Forms of a website with their answer counts (members).
create or replace function public.site_forms_list(p_website_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select w.organization_id into v_org from public.websites w where w.id = p_website_id;
  if v_org is null or not private.has_org_role(v_org, 'viewer') then
    raise exception 'Not allowed' using errcode = 'PT403';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(f) || jsonb_build_object(
             'answers', (select count(*) from public.form_submissions s where s.site_form_id = f.id),
             'last_answer_at', (select max(s.created_at) from public.form_submissions s where s.site_form_id = f.id))
           order by f.updated_at desc)
    from public.site_forms f
    where f.website_id = p_website_id and f.status <> 'archived'), '[]'::jsonb);
end;
$$;
revoke all on function public.site_forms_list(text) from public, anon;
grant execute on function public.site_forms_list(text) to authenticated;

-- ------------------------------------------------------------ public

-- A published form, as the hosted page shows it: fields, texts, look and the
-- website's public name and logo. Nothing internal (ids, owners, counts).
create or replace function public.public_form_get(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_form public.site_forms;
  v_branding jsonb;
  v_site public.websites;
begin
  if p_public_id is null or p_public_id !~ '^f[a-z0-9]{10}$' then
    return null;
  end if;
  select * into v_form from public.site_forms f where f.public_id = p_public_id and f.status = 'published';
  if v_form.id is null or not private.is_website_live(v_form.website_id) then
    return null;
  end if;
  select * into v_site from public.websites w where w.id = v_form.website_id;
  select s.value into v_branding from public.website_settings s
   where s.website_id = v_form.website_id and s.key = 'branding';
  return jsonb_build_object(
    'public_id', v_form.public_id,
    'name', v_form.name,
    'fields', v_form.fields,
    'settings', v_form.settings,
    'site', jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(v_branding ->> 'short_name', v_site.name),
      'domain', v_site.primary_domain,
      'logo_url', case when coalesce(v_branding ->> 'logo_url', '') ~ '^https://[^[:space:]<>"''`]+$'
                       then v_branding ->> 'logo_url' end))
  );
end;
$$;
revoke all on function public.public_form_get(text) from public;
grant execute on function public.public_form_get(text) to anon, authenticated;

-- An answer to a published form. p_subject: an opaque id of the sender chosen
-- by the LevelUp server (hashed IP) for the per-sender limit.
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
  v_text text;
  v_cols jsonb := '{}'::jsonb;
  v_data jsonb := '{}'::jsonb;
  v_ids text[];
  v_key text;
  v_ticket text;
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
  select coalesce(array_agg(e ->> 'id'), '{}') into v_ids from jsonb_array_elements(v_form.fields) e;
  for v_key in select jsonb_object_keys(p_values) loop
    if not (v_key = any (v_ids)) and v_key <> '_consent' then
      raise exception 'Unknown field' using errcode = '22023';
    end if;
  end loop;
  if v_form.settings ? 'consent_text' and coalesce((p_values ->> '_consent')::boolean, false) is not true then
    raise exception 'Consent is required' using errcode = '22023', hint = '_consent';
  end if;

  for f in select * from jsonb_array_elements(v_form.fields) loop
    v := p_values -> (f ->> 'id');
    -- Empty answers count as missing.
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

  -- Same limits as the other public forms (300 an hour per site, 5 per contact),
  -- plus 10 an hour per sender for this form.
  perform private.assert_public_write_allowed(v_form.website_id, v_cols ->> 'email', v_cols ->> 'phone');
  if nullif(p_subject, '') is not null then
    perform private.hit_rate_limit('public_form', v_form.public_id || ':' || left(p_subject, 80), 10, interval '1 hour');
  end if;

  v_ticket := private.generate_ticket_code(private.ticket_prefix(v_form.website_id));
  insert into public.form_submissions (website_id, organization_id, form_type, ticket_code, name, email, phone,
                                       company, message, data, source, site_form_id)
  values (v_form.website_id, v_form.organization_id, v_form.form_type, v_ticket,
          v_cols ->> 'name', v_cols ->> 'email', v_cols ->> 'phone', v_cols ->> 'company', v_cols ->> 'message',
          v_data, 'LevelUp form: ' || left(v_form.name, 60), v_form.id);
  return jsonb_build_object('ticket_code', v_ticket);
end;
$$;
revoke all on function public.public_form_submit(text, jsonb, text) from public;
grant execute on function public.public_form_submit(text, jsonb, text) to anon, authenticated;
