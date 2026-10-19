-- Signed-in functions that take typed text: inputs checked in the database
-- (security hardening). Same signatures and answers as before.
--
-- create_organization: name cleaned (one line, 120, no HTML, required), slug
--   cleaned and checked against the organizations slug format before the
--   insert (22023 instead of a raw constraint error); a taken slug is still
--   23505 (the dashboard maps it to "slug taken"), with a neutral message.
-- submit_access_request: business name 2 to 120, website 200 (http(s) link,
--   a bare domain is read as https://), phone 40 (digits and + ( ) . -),
--   message 1000 (multi-line): cleaned and refused when too long, malformed
--   or holding HTML markup (they used to be cut silently).
create or replace function public.create_organization(p_name text, p_slug text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org public.organizations;
  v_name text;
  v_slug text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not private.is_platform_admin()
     and not exists (select 1 from public.organization_members where user_id = v_uid) then
    raise exception 'Access to the dashboard must be approved first' using errcode = 'PT403';
  end if;
  v_name := private.check_text(p_name, 120, 'organization name');
  if v_name is null then
    raise exception 'Organization name is required' using errcode = '22023';
  end if;
  v_slug := lower(private.clean_line(p_slug, 100));
  if v_slug is null or v_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$' then
    raise exception 'Invalid organization slug' using errcode = '22023';
  end if;
  if (select count(*) from public.organization_members where user_id = v_uid and role = 'owner') >= 5 then
    raise exception 'Organization limit reached' using errcode = 'P0001';
  end if;
  begin
    insert into public.organizations (name, slug, created_by) values (v_name, v_slug, v_uid) returning * into v_org;
  exception when unique_violation then
    raise exception 'This slug is already taken' using errcode = '23505';
  end;
  insert into public.organization_members (organization_id, user_id, role) values (v_org.id, v_uid, 'owner');
  return v_org;
end;
$$;

create or replace function public.submit_access_request(
  p_business_name text,
  p_website text default null,
  p_phone text default null,
  p_message text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_website text;
  v_phone text;
  v_message text;
  v_status text;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  if not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'email not verified' using errcode = 'PT403';
  end if;
  if exists (select 1 from public.organization_members where user_id = v_user) then
    return 'member';
  end if;
  v_name := private.check_text(p_business_name, 120, 'business name');
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'business name required' using errcode = '22023';
  end if;
  v_website := private.check_url(p_website, 200, 'website');
  v_phone := private.check_text(p_phone, 40, 'phone');
  if v_phone is not null and not private.is_valid_phone(v_phone) then
    raise exception 'Invalid phone number' using errcode = '22023';
  end if;
  v_message := private.check_text(p_message, 1000, 'message', true);
  select status into v_status from public.access_requests where user_id = v_user;
  if v_status = 'rejected' then
    return 'rejected';
  end if;
  perform private.hit_rate_limit('access_request', v_user::text, 10, interval '1 hour');
  insert into public.access_requests (user_id, business_name, website, phone, message)
  values (v_user, v_name, v_website, v_phone, v_message)
  on conflict (user_id) do update
    set business_name = excluded.business_name, website = excluded.website, phone = excluded.phone,
        message = excluded.message, updated_at = now()
    where public.access_requests.status = 'pending';
  return 'pending';
end;
$$;
