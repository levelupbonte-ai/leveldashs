-- Dashboard access on approval + brand images.
--
-- Anyone can create a LevelUp account (LevelStudio stays open), but the
-- dashboard only opens to members of an organization. Invited people become
-- members automatically when they verify their e-mail (private.accept_invitations);
-- everyone else files an access request that LevelUp staff approve or reject.

create table if not exists public.access_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  business_name text not null check (char_length(business_name) between 2 and 120),
  website text check (website is null or char_length(website) <= 200),
  phone text check (phone is null or char_length(phone) <= 40),
  message text check (message is null or char_length(message) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  organization_id uuid references public.organizations (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.access_requests enable row level security;
revoke all on public.access_requests from anon;
revoke insert, update, delete, truncate on public.access_requests from authenticated;
grant select on public.access_requests to authenticated;

create policy access_requests_select on public.access_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_platform_admin());

-- The applicant writes through submit_access_request only (status is never theirs to set).
create or replace function public.submit_access_request(
  p_business_name text, p_website text default null, p_phone text default null, p_message text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := private.clean_text(p_business_name, 120);
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
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'business name required' using errcode = '22023';
  end if;
  select status into v_status from public.access_requests where user_id = v_user;
  if v_status = 'rejected' then
    return 'rejected';
  end if;
  insert into public.access_requests (user_id, business_name, website, phone, message)
  values (v_user, v_name, private.clean_text(p_website, 200), private.clean_text(p_phone, 40), private.clean_text(p_message, 1000))
  on conflict (user_id) do update
    set business_name = excluded.business_name, website = excluded.website, phone = excluded.phone,
        message = excluded.message, updated_at = now()
    where public.access_requests.status = 'pending';
  return 'pending';
end;
$$;
revoke all on function public.submit_access_request(text, text, text, text) from public, anon;
grant execute on function public.submit_access_request(text, text, text, text) to authenticated;

-- LevelUp staff: approve (into an existing organization, or a new one named after
-- the business, as owner) or reject. Requires a 2FA session like other admin RPCs.
create or replace function public.review_access_request(
  p_user_id uuid, p_approve boolean, p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.access_requests;
  v_email text;
  v_org uuid := p_organization_id;
  v_slug text;
begin
  perform private.assert_platform_admin();
  select * into v_req from public.access_requests where user_id = p_user_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'PT404';
  end if;
  select email into v_email from auth.users where id = p_user_id;

  if not p_approve then
    update public.access_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where user_id = p_user_id;
    return jsonb_build_object('status', 'rejected', 'email', v_email);
  end if;

  if v_org is null then
    v_slug := trim(both '-' from left(regexp_replace(lower(
      translate(v_req.business_name, 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')), '[^a-z0-9]+', '-', 'g'), 40));
    if v_slug = '' then v_slug := 'client'; end if;
    if exists (select 1 from public.organizations where slug = v_slug) then
      v_slug := v_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
    end if;
    insert into public.organizations (slug, name, created_by) values (v_slug, v_req.business_name, auth.uid())
    returning id into v_org;
  elsif not exists (select 1 from public.organizations where id = v_org and status <> 'archived') then
    raise exception 'organization not found' using errcode = 'PT404';
  end if;

  perform private.invite_member(v_org, v_email, 'owner');
  update public.access_requests
  set status = 'approved', organization_id = v_org, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where user_id = p_user_id;
  return jsonb_build_object('status', 'approved', 'organization_id', v_org, 'email', v_email);
end;
$$;
revoke all on function public.review_access_request(uuid, boolean, uuid) from public, anon;
grant execute on function public.review_access_request(uuid, boolean, uuid) to authenticated;

-- Organization logo (replaces the initials square in the dashboard).
alter table public.organizations add column if not exists logo_url text
  check (logo_url is null or (char_length(logo_url) <= 2048 and logo_url ~ '^https://'));
grant update (logo_url) on public.organizations to authenticated;

create or replace function private.safe_uuid(p text)
returns uuid language sql immutable set search_path = ''
as $$ select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end $$;

-- Public "brand" bucket: avatars/<user id>/... and orgs/<organization id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand', 'brand', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy brand_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'brand' and (
    ((storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = (select auth.uid())::text)
    or ((storage.foldername(name))[1] = 'orgs' and coalesce(private.has_org_role(private.safe_uuid((storage.foldername(name))[2]), 'admin'), false))
  ));
create policy brand_update on storage.objects for update to authenticated
  using (bucket_id = 'brand' and (
    ((storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = (select auth.uid())::text)
    or ((storage.foldername(name))[1] = 'orgs' and coalesce(private.has_org_role(private.safe_uuid((storage.foldername(name))[2]), 'admin'), false))
  ));
create policy brand_delete on storage.objects for delete to authenticated
  using (bucket_id = 'brand' and (
    ((storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = (select auth.uid())::text)
    or ((storage.foldername(name))[1] = 'orgs' and coalesce(private.has_org_role(private.safe_uuid((storage.foldername(name))[2]), 'admin'), false))
  ));

-- Approval cannot be bypassed: creating an organization (which makes the
-- creator its owner, hence a dashboard member) is reserved to LevelUp staff and
-- to clients who already have access.
create or replace function public.create_organization(p_name text, p_slug text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org public.organizations;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not private.is_platform_admin()
     and not exists (select 1 from public.organization_members where user_id = v_uid) then
    raise exception 'Access to the dashboard must be approved first' using errcode = 'PT403';
  end if;
  if (select count(*) from public.organization_members where user_id = v_uid and role = 'owner') >= 5 then
    raise exception 'Organization limit reached' using errcode = 'P0001';
  end if;
  insert into public.organizations (name, slug, created_by) values (btrim(p_name), lower(btrim(p_slug)), v_uid) returning * into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org.id, v_uid, 'owner');
  return v_org;
end;
$$;
