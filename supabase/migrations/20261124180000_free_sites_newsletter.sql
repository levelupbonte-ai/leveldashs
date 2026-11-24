-- Free sites: newsletter sign-ups reach the dashboard.
--
-- LevelStudio turns a sign-up form into data-lu-form="newsletter", and
-- submit_form needs the website's "newsletter" feature for it; published
-- sites only had "contact_form", so a sign-up was refused ("This form is not
-- available"). New publications get both, and sites already published get
-- the newsletter feature now.

create or replace function public.studio_publish_site(
  p_user uuid,
  p_project uuid,
  p_subdomain text,
  p_name text,
  p_html text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub text := lower(btrim(coalesce(p_subdomain, '')));
  v_name text := coalesce(private.clean_text(p_name, 120), 'Mon site');
  v_email text;
  v_confirmed boolean;
  v_project public.studio_projects;
  v_pub public.site_publications;
  v_org uuid;
  v_site text;
  v_slug text;
  v_problem text;
  v_first boolean := false;
  v_origin text;
begin
  if p_user is null or p_project is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_html is null or octet_length(p_html) < 200 or octet_length(p_html) > 2000000 then
    raise exception 'invalid_html' using errcode = '22023';
  end if;

  select lower(u.email), u.email_confirmed_at is not null into v_email, v_confirmed
  from auth.users u where u.id = p_user and u.deleted_at is null;
  if v_email is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  -- A confirmed address first: every published site has a reachable owner.
  if not coalesce(v_confirmed, false) then
    raise exception 'email_not_confirmed' using errcode = 'PT403';
  end if;

  select * into v_project from public.studio_projects
  where id = p_project and user_id = p_user and archived_at is null
  for update;
  if not found then
    raise exception 'project_not_found' using errcode = 'PT404';
  end if;

  perform private.hit_rate_limit('site_publish', p_user::text, 60, interval '1 day');

  select * into v_pub from public.site_publications where studio_project_id = p_project for update;

  if found then
    -- Republish: same website, maybe a new address.
    if v_pub.status = 'suspended' then
      raise exception 'site_suspended' using errcode = 'PT403';
    end if;
    v_problem := private.site_subdomain_problem(v_sub, v_pub.website_id);
    if v_problem <> '' then
      raise exception 'subdomain_%', v_problem using errcode = 'PT409';
    end if;
    v_site := v_pub.website_id;
    v_org := v_pub.organization_id;
    v_origin := 'https://' || v_sub || '.' || private.sites_root_domain();
    update public.site_publications
    set subdomain = v_sub, html = p_html, version = version + 1, published_by = p_user, published_at = now()
    where website_id = v_site
    returning * into v_pub;
    update public.websites
    set primary_domain = v_sub || '.' || private.sites_root_domain(),
        allowed_origins = private.normalize_origins(
          array(select o from unnest(allowed_origins) o where o !~ ('\.' || replace(private.sites_root_domain(), '.', '\.') || '$'))
          || array[v_origin])
    where id = v_site;
  else
    v_problem := private.site_subdomain_problem(v_sub, null);
    if v_problem <> '' then
      raise exception 'subdomain_%', v_problem using errcode = 'PT409';
    end if;
    v_first := true;
    v_origin := 'https://' || v_sub || '.' || private.sites_root_domain();

    -- Published before, then taken offline: the same website comes back.
    select w.id, w.organization_id into v_site, v_org
    from public.websites w
    where w.id = v_project.website_id and w.status <> 'archived'
      and exists (select 1 from public.organization_members m
                  where m.organization_id = w.organization_id and m.user_id = p_user and m.role = 'owner');

    if v_site is not null then
      -- Back online: it takes a site slot again (the other live sites count).
      perform private.assert_within_limit(v_org, 'websites', private.sites_in_use(v_org, v_site));
      update public.websites
      set status = 'active', primary_domain = v_sub || '.' || private.sites_root_domain(),
          allowed_origins = private.normalize_origins(
            array(select o from unnest(allowed_origins) o where o !~ ('\.' || replace(private.sites_root_domain(), '.', '\.') || '$'))
            || array[v_origin])
      where id = v_site;
    else
      -- The builder's own organization (the oldest they own), else a new one.
      select m.organization_id into v_org
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = p_user and m.role = 'owner' and o.status = 'active'
      order by o.created_at
      limit 1;

      if v_org is null then
        v_slug := trim(both '-' from left(trim(both '-' from regexp_replace(lower(
          translate(v_name, 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')),
          '[^a-z0-9]+', '-', 'g')), 40));
        if v_slug = '' or length(v_slug) < 2 then v_slug := v_sub; end if;
        if exists (select 1 from public.organizations where slug = v_slug) then
          v_slug := left(v_slug, 40) || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
        end if;
        insert into public.organizations (slug, name, created_by)
        values (v_slug, v_name, p_user)
        returning id into v_org;
        insert into public.organization_members (organization_id, user_id, role)
        values (v_org, p_user, 'owner');
      end if;

      perform private.assert_within_limit(v_org, 'websites', private.sites_in_use(v_org, null));

      insert into public.websites (organization_id, name, primary_domain, site_type, status, allowed_origins)
      values (v_org, v_name, v_sub || '.' || private.sites_root_domain(), 'levelstudio', 'active',
              private.normalize_origins(array[v_origin]))
      returning id into v_site;

      -- Messages and sign-ups (newsletter) reach the dashboard; registrations use the contact form.
      insert into public.website_features (website_id, organization_id, feature_key)
      values (v_site, v_org, 'contact_form'), (v_site, v_org, 'newsletter')
      on conflict do nothing;
    end if;

    insert into public.site_publications (website_id, organization_id, subdomain, studio_project_id, html, published_by)
    values (v_site, v_org, v_sub, p_project, p_html, p_user)
    returning * into v_pub;

    update public.studio_projects set organization_id = v_org, website_id = v_site where id = p_project;
  end if;

  perform private.hq_log(case when v_first then 'site.published' else 'site.republished' end,
    'website', v_site,
    jsonb_build_object('user_id', p_user, 'subdomain', v_sub, 'version', v_pub.version, 'project_id', p_project));

  return jsonb_build_object(
    'website_id', v_site,
    'organization_id', v_org,
    'subdomain', v_pub.subdomain,
    'url', 'https://' || v_pub.subdomain || '.' || private.sites_root_domain(),
    'version', v_pub.version,
    'status', v_pub.status,
    'first', v_first,
    'published_at', v_pub.published_at
  );
end;
$$;

revoke all on function public.studio_publish_site(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.studio_publish_site(uuid, uuid, text, text, text) to service_role;

insert into public.website_features (website_id, organization_id, feature_key)
select w.id, w.organization_id, 'newsletter'
from public.websites w
where w.site_type = 'levelstudio'
on conflict do nothing;
