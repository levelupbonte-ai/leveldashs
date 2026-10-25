-- Access request review: LevelUp staff choose explicitly where an approved
-- account goes. The old review_access_request(p_user_id, true) created a new,
-- empty organization named after the business when no organization was given
-- (Black Pater and "moni" incidents). Now:
--
--   * admin_review_access_request(p_mode => 'connect' | 'create' | 'reject'):
--     connect needs a valid, non-archived website id (ws_...); an organization is
--     only ever created with p_mode = 'create'; the account e-mail must be
--     confirmed; a second confirmation (the site id typed again) is required when
--     the organization already has an owner; already-member duplicates are refused;
--     the same call twice returns the same result (idempotent);
--   * "fix": an approved request whose organization has no website can be
--     reconnected to an existing site; the empty organization is archived
--     (status archived, never removed);
--   * every decision is written to the existing append-only audit log
--     (public.hq_audit_log through private.hq_log, same database as LevelUp HQ);
--   * review_access_request(uuid, boolean, uuid) keeps its signature and
--     delegates; without an organization it now refuses instead of creating one.
--
-- Matching hints (requested website vs site domains, e-mail domain vs site
-- domains) are HINTS for staff only: they never grant anything.
--
-- Applied through the Supabase MCP in parts (@part markers).

-- @part 1: host helpers, request columns -------------------------------------

-- Host of a URL or bare domain: lower case, no scheme, credentials, port, path,
-- query, fragment, trailing dot or leading www. Null when it is not a domain.
create or replace function private.url_host(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  with h as (
    select regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(btrim(coalesce(p_value, ''))), '^[a-z][a-z0-9+.-]*://', ''),
            '^[^/?#@\\]*@', ''),
          '[/?#\\].*$', ''),
        ':[0-9]*$', ''),
      '^www\.|\.$', '', 'g') as v
  )
  select case
    when char_length(v) between 3 and 253
     and v ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    then v
  end
  from h;
$$;

-- Domain of an e-mail address, same normalisation as url_host.
create or replace function private.email_domain(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select private.url_host(split_part(lower(btrim(coalesce(p_email, ''))), '@', 2));
$$;

-- Every host a website answers on: its primary domain and its allowed origins.
create or replace function private.website_hosts(p_primary text, p_origins text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.h) filter (where x.h is not null), '{}'::text[])
  from unnest(array_prepend(p_primary, coalesce(p_origins, '{}'::text[]))) as u(v)
  cross join lateral (select private.url_host(u.v) as h) as x;
$$;

revoke all on function private.url_host(text) from public, anon;
revoke all on function private.email_domain(text) from public, anon;
revoke all on function private.website_hosts(text, text[]) from public, anon;

-- The website the account was connected to (informational, no foreign key so a
-- website can still be archived or moved freely).
alter table public.access_requests add column if not exists website_id text
  check (website_id is null or website_id ~ '^ws_[a-z0-9]{8,32}$');
create index if not exists access_requests_organization_idx on public.access_requests (organization_id);

-- @part 2: staff reads ----------------------------------------------------------

-- Every request with what staff need to decide: account e-mail and whether it is
-- confirmed, the organization it was attached to and how many websites it has.
create or replace function public.admin_list_access_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_platform_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by (x.status = 'pending') desc, x.created_at desc)
    from (
      select r.user_id, r.business_name, r.website, r.phone, r.message, r.status,
        r.created_at, r.reviewed_at, u.email, (u.email_confirmed_at is not null) as email_confirmed,
        p.full_name, r.organization_id, o.name as organization_name, o.status as organization_status,
        (select count(*)::int from public.websites w
          where w.organization_id = r.organization_id and w.status <> 'archived') as organization_websites,
        r.website_id, ws.name as website_name, ws.primary_domain as website_domain
      from public.access_requests r
      join auth.users u on u.id = r.user_id
      left join public.profiles p on p.id = r.user_id
      left join public.organizations o on o.id = r.organization_id
      left join public.websites ws on ws.id = r.website_id
      order by r.created_at desc
      limit 200
    ) as x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_access_requests() from public, anon;
grant execute on function public.admin_list_access_requests() to authenticated;

-- One request and the candidates to connect it to: every non-archived website
-- (with its organization, members, owners, hosts and the two matching hints) and
-- every non-archived organization (for name similarity, computed by the app).
create or replace function public.admin_access_review_context(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_req public.access_requests;
  v_email text;
  v_confirmed boolean;
  v_host text;
  v_email_domain text;
begin
  perform private.assert_platform_admin();
  select * into v_req from public.access_requests where user_id = p_user_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'PT404';
  end if;
  select lower(u.email), u.email_confirmed_at is not null into v_email, v_confirmed
  from auth.users u where u.id = p_user_id;
  v_host := private.url_host(v_req.website);
  v_email_domain := private.email_domain(v_email);

  return jsonb_build_object(
    'request', jsonb_build_object(
      'user_id', v_req.user_id, 'business_name', v_req.business_name, 'website', v_req.website,
      'phone', v_req.phone, 'message', v_req.message, 'status', v_req.status,
      'created_at', v_req.created_at, 'organization_id', v_req.organization_id,
      'website_id', v_req.website_id,
      'full_name', (select p.full_name from public.profiles p where p.id = p_user_id)
    ),
    'email', v_email,
    'email_confirmed', coalesce(v_confirmed, false),
    'requested_host', v_host,
    'email_domain', v_email_domain,
    'current_organization', (
      select jsonb_build_object('id', o.id, 'name', o.name, 'status', o.status,
        'websites', (select count(*)::int from public.websites w where w.organization_id = o.id and w.status <> 'archived'),
        'members', (select count(*)::int from public.organization_members m where m.organization_id = o.id))
      from public.organizations o where o.id = v_req.organization_id
    ),
    'websites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.name, 'primary_domain', w.primary_domain, 'status', w.status,
        'organization_id', o.id, 'organization_name', o.name,
        'members', (select count(*)::int from public.organization_members m where m.organization_id = o.id),
        'owners', (select count(*)::int from public.organization_members m where m.organization_id = o.id and m.role = 'owner'),
        'applicant_is_member', exists (select 1 from public.organization_members m where m.organization_id = o.id and m.user_id = p_user_id),
        'hosts', to_jsonb(private.website_hosts(w.primary_domain, w.allowed_origins)),
        'host_match', v_host is not null and v_host = any (private.website_hosts(w.primary_domain, w.allowed_origins)),
        'email_match', v_email_domain is not null and v_email_domain = any (private.website_hosts(w.primary_domain, w.allowed_origins))
      ) order by w.name)
      from public.websites w
      join public.organizations o on o.id = w.organization_id
      where w.status <> 'archived' and o.status <> 'archived'
    ), '[]'::jsonb),
    'organizations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name,
        'websites', (select count(*)::int from public.websites w where w.organization_id = o.id and w.status <> 'archived'),
        'owners', (select count(*)::int from public.organization_members m where m.organization_id = o.id and m.role = 'owner')
      ) order by o.name)
      from public.organizations o
      where o.status <> 'archived'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_access_review_context(uuid) from public, anon;
grant execute on function public.admin_access_review_context(uuid) to authenticated;
