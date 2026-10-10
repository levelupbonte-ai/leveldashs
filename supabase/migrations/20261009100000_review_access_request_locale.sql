-- Decision e-mails in the applicant's language: review_access_request also returns
-- the locale saved by the dashboard's language switcher (user_metadata.locale,
-- 'en' or 'fr'; null when never chosen, then the e-mail is sent in English).
-- Same function otherwise (see 20261008090000_access_requests_and_logos.sql).
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
  v_locale text;
  v_org uuid := p_organization_id;
  v_slug text;
begin
  perform private.assert_platform_admin();
  select * into v_req from public.access_requests where user_id = p_user_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'PT404';
  end if;
  select email, raw_user_meta_data ->> 'locale' into v_email, v_locale from auth.users where id = p_user_id;

  if not p_approve then
    update public.access_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where user_id = p_user_id;
    return jsonb_build_object('status', 'rejected', 'email', v_email, 'locale', v_locale);
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
  return jsonb_build_object('status', 'approved', 'organization_id', v_org, 'email', v_email, 'locale', v_locale);
end;
$$;
revoke all on function public.review_access_request(uuid, boolean, uuid) from public, anon;
grant execute on function public.review_access_request(uuid, boolean, uuid) to authenticated;
