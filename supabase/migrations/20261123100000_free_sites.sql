-- Free sites, phase 1: a LevelStudio project is published on a subdomain of
-- the free-sites domain (private.sites_config) and becomes a real LevelUp
-- website, owned by the person who built it, visible in their dashboard.
--
-- Only the LevelStudio server (service role) calls these functions: it checks
-- the session, prepares the HTML (assets, LevelUp tag, forms) and serves the
-- published sites. Browsers never call them.

-- ---------------------------------------------------------------- config

create table if not exists private.sites_config (
  id boolean primary key default true check (id),
  root_domain text not null check (root_domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  updated_at timestamptz not null default now()
);
-- Placeholder until the owner picks the free-sites domain: one UPDATE moves
-- every site (subdomains are stored without the domain).
insert into private.sites_config (id, root_domain) values (true, 'levelup.site')
on conflict (id) do nothing;

create or replace function private.sites_root_domain()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select root_domain from private.sites_config where id;
$$;

-- ---------------------------------------------------------------- table

create table if not exists public.site_publications (
  website_id text primary key references public.websites (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subdomain text not null unique
    check (subdomain ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$' and position('--' in subdomain) = 0),
  studio_project_id uuid unique references public.studio_projects (id) on delete set null,
  html text not null check (octet_length(html) <= 2000000),
  version integer not null default 1,
  status text not null default 'live' check (status in ('live', 'suspended')),
  suspended_reason text,
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_publications enable row level security;
revoke all on public.site_publications from anon, authenticated;
-- Members can see their own publication (address, status, date) but never
-- write it: publishing goes through LevelStudio.
grant select (website_id, organization_id, subdomain, version, status, published_at, updated_at)
  on public.site_publications to authenticated;
drop policy if exists site_publications_member_read on public.site_publications;
create policy site_publications_member_read on public.site_publications
  for select to authenticated
  using (private.has_org_role(organization_id, 'viewer'));

drop trigger if exists site_publications_set_updated_at on public.site_publications;
create trigger site_publications_set_updated_at
  before update on public.site_publications
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------- helpers

-- Names that would read as LevelUp itself, or as a system address.
create or replace function private.site_subdomain_reserved(p_sub text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_sub = any (array[
    'www','app','api','admin','administrator','dashboard','studio','levelup','levelstudio',
    'mail','email','smtp','imap','pop','ftp','webmail','mx','ns','ns1','ns2','dns',
    'support','help','status','docs','blog','news','shop','store','cdn','static','assets',
    'img','images','media','files','login','signin','signup','register','account','accounts',
    'auth','oauth','sso','secure','security','billing','pay','payment','payments','checkout',
    'bank','paypal','square','stripe','apple','google','microsoft','facebook','instagram',
    'whatsapp','amazon','netflix','root','test','demo','staging','dev','preview','sites','site',
    'abuse','postmaster','hostmaster','webmaster','noreply','no-reply','official','verify',
    'update','wallet','crypto'
  ])
  or p_sub ~ '^(levelup|level-up|lvlup)';
$$;

-- '' when free, else why not: invalid | reserved | taken.
create or replace function private.site_subdomain_problem(p_sub text, p_website_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_sub is null or p_sub !~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$' or position('--' in p_sub) > 0 then
    return 'invalid';
  end if;
  if private.site_subdomain_reserved(p_sub) then
    return 'reserved';
  end if;
  if exists (
    select 1 from public.site_publications sp
    where sp.subdomain = p_sub and sp.website_id is distinct from p_website_id
  ) then
    return 'taken';
  end if;
  return '';
end;
$$;

-- ---------------------------------------------------------------- studio RPCs

-- Current publication of a project (null when not published).
create or replace function public.studio_site_publication(p_user uuid, p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'website_id', sp.website_id,
    'organization_id', sp.organization_id,
    'subdomain', sp.subdomain,
    'url', 'https://' || sp.subdomain || '.' || private.sites_root_domain(),
    'version', sp.version,
    'status', sp.status,
    'published_at', sp.published_at,
    'updated_at', sp.updated_at
  )
  from public.site_publications sp
  join public.studio_projects p on p.id = sp.studio_project_id
  where p.id = p_project and p.user_id = p_user;
$$;

create or replace function public.studio_site_subdomain_check(p_user uuid, p_project uuid, p_subdomain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub text := lower(btrim(coalesce(p_subdomain, '')));
  v_site text;
  v_problem text;
begin
  select sp.website_id into v_site
  from public.site_publications sp
  join public.studio_projects p on p.id = sp.studio_project_id
  where p.id = p_project and p.user_id = p_user;
  v_problem := private.site_subdomain_problem(v_sub, v_site);
  return jsonb_build_object(
    'subdomain', v_sub,
    'available', v_problem = '',
    'reason', nullif(v_problem, ''),
    'domain', private.sites_root_domain()
  );
end;
$$;

-- Publishes (or republishes) a project. The first time, the site becomes a
-- LevelUp website in the builder's own organization (created if needed) on
-- the free plan's limits, with its address as the only allowed origin.
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

      perform private.assert_within_limit(v_org, 'websites',
        (select count(*) from public.websites w where w.organization_id = v_org and w.status <> 'archived'));

      insert into public.websites (organization_id, name, primary_domain, site_type, status, allowed_origins)
      values (v_org, v_name, v_sub || '.' || private.sites_root_domain(), 'levelstudio', 'active',
              private.normalize_origins(array[v_origin]))
      returning id into v_site;

      insert into public.website_features (website_id, organization_id, feature_key)
      values (v_site, v_org, 'contact_form')
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

-- Takes the site offline. The website stays in the dashboard (its messages,
-- statistics and settings are kept); publishing again brings it back.
create or replace function public.studio_unpublish_site(p_user uuid, p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pub public.site_publications;
begin
  select sp.* into v_pub
  from public.site_publications sp
  join public.studio_projects p on p.id = sp.studio_project_id
  where p.id = p_project and p.user_id = p_user
  for update of sp;
  if not found then
    return jsonb_build_object('unpublished', false);
  end if;
  delete from public.site_publications where website_id = v_pub.website_id;
  update public.websites set status = 'draft' where id = v_pub.website_id;
  perform private.hq_log('site.unpublished', 'website', v_pub.website_id,
    jsonb_build_object('user_id', p_user, 'subdomain', v_pub.subdomain));
  return jsonb_build_object('unpublished', true, 'website_id', v_pub.website_id);
end;
$$;

-- What the hosting server shows at <subdomain>.<domain>.
create or replace function public.hosted_site(p_subdomain text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'website_id', sp.website_id,
    'html', sp.html,
    'version', sp.version,
    'updated_at', sp.updated_at,
    'show_powered_by', w.show_powered_by,
    'name', w.name
  )
  from public.site_publications sp
  join public.websites w on w.id = sp.website_id
  join public.organizations o on o.id = sp.organization_id
  where sp.subdomain = lower(btrim(p_subdomain))
    and sp.status = 'live'
    and w.status = 'active'
    and o.status = 'active';
$$;

-- ---------------------------------------------------------------- grants

revoke all on function private.sites_root_domain() from public, anon, authenticated;
revoke all on function private.site_subdomain_reserved(text) from public, anon, authenticated;
revoke all on function private.site_subdomain_problem(text, text) from public, anon, authenticated;
revoke all on function public.studio_site_publication(uuid, uuid) from public, anon, authenticated;
revoke all on function public.studio_site_subdomain_check(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.studio_publish_site(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.studio_unpublish_site(uuid, uuid) from public, anon, authenticated;
revoke all on function public.hosted_site(text) from public, anon, authenticated;
grant execute on function public.studio_site_publication(uuid, uuid) to service_role;
grant execute on function public.studio_site_subdomain_check(uuid, uuid, text) to service_role;
grant execute on function public.studio_publish_site(uuid, uuid, text, text, text) to service_role;
grant execute on function public.studio_unpublish_site(uuid, uuid) to service_role;
grant execute on function public.hosted_site(text) to service_role;
