-- Explicit access request decisions (see 20261024100000_access_review.sql).
--
-- admin_review_access_request(p_user_id, p_mode, ...)
--   p_mode = 'connect'  attach the account to an existing website (p_website_id,
--                       ws_...) with p_role (default owner when the organization
--                       has no owner, admin otherwise). When the organization
--                       already has an owner, p_confirm_website_id must repeat the
--                       site id. Also fixes an approved request whose organization
--                       has no website: that empty organization is archived.
--   p_mode = 'create'   new organization (p_organization_name, default the business
--                       name), optional draft website (p_website_name /
--                       p_website_domain), the account becomes its owner.
--   p_mode = 'reject'   decline a pending request.
-- Errors (message = code for the app): invalid_mode, request_not_found,
-- email_unconfirmed, invalid_website_id, website_not_found, website_archived,
-- already_member, already_approved, confirmation_required, invalid_role,
-- invalid_name, invalid_domain, domain_taken.

-- @part 3: the decision function ------------------------------------------------

create or replace function public.admin_review_access_request(
  p_user_id uuid,
  p_mode text,
  p_website_id text default null,
  p_role text default null,
  p_confirm_website_id text default null,
  p_organization_name text default null,
  p_website_name text default null,
  p_website_domain text default null
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
  v_confirmed boolean;
  v_site_id text;
  v_site record;
  v_org uuid;
  v_org_name text;
  v_site_name text;
  v_site_domain text;
  v_role text;
  v_owners integer := 0;
  v_prev uuid;
  v_archived uuid;
  v_slug text;
  v_domain text;
  v_hosts text[];
  v_host_match boolean := false;
  v_email_match boolean := false;
  v_fix boolean := false;
begin
  perform private.assert_platform_admin();
  if p_mode is null or p_mode not in ('connect', 'create', 'reject') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;

  select * into v_req from public.access_requests where user_id = p_user_id for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'PT404';
  end if;
  select lower(u.email), u.raw_user_meta_data ->> 'locale', u.email_confirmed_at is not null
  into v_email, v_locale, v_confirmed
  from auth.users u where u.id = p_user_id;

  -- Decline ------------------------------------------------------------------
  if p_mode = 'reject' then
    if v_req.status = 'approved' then
      raise exception 'already_approved' using errcode = 'PT409';
    end if;
    if v_req.status = 'pending' then
      update public.access_requests
      set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
      where user_id = p_user_id;
      perform private.hq_log('access_request.rejected', 'access_request', p_user_id::text,
        jsonb_build_object('business_name', v_req.business_name));
    end if;
    return jsonb_build_object('status', 'rejected', 'mode', 'reject', 'email', v_email,
      'locale', v_locale, 'unchanged', v_req.status = 'rejected');
  end if;

  -- Approvals need a confirmed e-mail address (whoever owns the mailbox).
  if v_email is null or not coalesce(v_confirmed, false) then
    raise exception 'email_unconfirmed' using errcode = 'PT403';
  end if;

  -- Connect to an existing website -----------------------------------------------
  if p_mode = 'connect' then
    v_site_id := lower(btrim(coalesce(p_website_id, '')));
    if v_site_id !~ '^ws_[a-z0-9]{8,32}$' then
      raise exception 'invalid_website_id' using errcode = '22023';
    end if;
    select w.id, w.name, w.primary_domain, w.status, w.allowed_origins, w.organization_id,
           o.name as org_name, o.status as org_status
    into v_site
    from public.websites w
    join public.organizations o on o.id = w.organization_id
    where w.id = v_site_id;
    if not found then
      raise exception 'website_not_found' using errcode = 'PT404';
    end if;
    if v_site.status = 'archived' or v_site.org_status = 'archived' then
      raise exception 'website_archived' using errcode = 'PT409';
    end if;
    v_org := v_site.organization_id;
    -- Serialise decisions on the same organization (owner count below).
    perform 1 from public.organizations where id = v_org for update;

    -- Same decision twice: same answer, nothing changes.
    if v_req.status = 'approved' and v_req.organization_id = v_org
       and exists (select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = p_user_id) then
      return jsonb_build_object('status', 'approved', 'mode', 'connect', 'organization_id', v_org,
        'organization_name', v_site.org_name, 'website_id', v_site.id, 'website_name', v_site.name,
        'website_domain', v_site.primary_domain,
        'role', (select m.role from public.organization_members m where m.organization_id = v_org and m.user_id = p_user_id),
        'email', v_email, 'locale', v_locale, 'archived_organization_id', null, 'unchanged', true);
    end if;

    if v_req.status = 'approved' then
      -- Fix only: the organization it was attached to has no website.
      if v_req.organization_id is not null and exists (
        select 1 from public.websites w where w.organization_id = v_req.organization_id and w.status <> 'archived'
      ) then
        raise exception 'already_approved' using errcode = 'PT409';
      end if;
      v_fix := true;
      v_prev := v_req.organization_id;
    end if;

    if exists (select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = p_user_id) then
      raise exception 'already_member' using errcode = 'PT409';
    end if;

    select count(*) into v_owners from public.organization_members m
    where m.organization_id = v_org and m.role = 'owner';
    v_role := coalesce(nullif(btrim(coalesce(p_role, '')), ''), case when v_owners = 0 then 'owner' else 'admin' end);
    if v_role not in ('owner', 'admin', 'editor', 'viewer') then
      raise exception 'invalid_role' using errcode = '22023';
    end if;
    if v_owners > 0 and lower(btrim(coalesce(p_confirm_website_id, ''))) <> v_site_id then
      raise exception 'confirmation_required' using errcode = 'PT409';
    end if;

    v_hosts := private.website_hosts(v_site.primary_domain, v_site.allowed_origins);
    v_host_match := coalesce(private.url_host(v_req.website) = any (v_hosts), false);
    v_email_match := coalesce(private.email_domain(v_email) = any (v_hosts), false);

    insert into public.organization_members (organization_id, user_id, role)
    values (v_org, p_user_id, v_role);

    -- The empty organization created by mistake: archived when nothing else uses it.
    if v_prev is not null and v_prev <> v_org
       and not exists (select 1 from public.websites w where w.organization_id = v_prev)
       and not exists (select 1 from public.organization_members m where m.organization_id = v_prev and m.user_id <> p_user_id)
       and exists (select 1 from public.organizations o where o.id = v_prev and o.status <> 'archived') then
      update public.organizations set status = 'archived', updated_at = now() where id = v_prev;
      v_archived := v_prev;
      perform private.hq_log('organization.archived', 'organization', v_prev::text,
        jsonb_build_object('reason', 'empty_after_access_fix', 'user_id', p_user_id, 'moved_to', v_org));
    end if;

    update public.access_requests
    set status = 'approved', organization_id = v_org, website_id = v_site.id,
        reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where user_id = p_user_id;

    perform private.hq_log(
      case when v_fix then 'access_request.reconnected' else 'access_request.approved' end,
      'access_request', p_user_id::text,
      jsonb_build_object('mode', 'connect', 'website_id', v_site.id, 'organization_id', v_org,
        'role', v_role, 'owner_existed', v_owners > 0, 'host_match', v_host_match,
        'email_match', v_email_match, 'archived_organization_id', v_archived,
        'previous_organization_id', v_prev));

    return jsonb_build_object('status', 'approved', 'mode', 'connect', 'organization_id', v_org,
      'organization_name', v_site.org_name, 'website_id', v_site.id, 'website_name', v_site.name,
      'website_domain', v_site.primary_domain, 'role', v_role, 'email', v_email, 'locale', v_locale,
      'archived_organization_id', v_archived, 'unchanged', false);
  end if;

  -- Create a new client (explicit choice only) ------------------------------------
  if v_req.status = 'approved' then
    raise exception 'already_approved' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.organization_members m where m.user_id = p_user_id) then
    raise exception 'already_member' using errcode = 'PT409';
  end if;
  v_org_name := private.check_text(coalesce(nullif(btrim(coalesce(p_organization_name, '')), ''), v_req.business_name), 120, 'organization name');
  if v_org_name is null or char_length(v_org_name) < 2 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_website_domain, '')), '') is not null then
    v_domain := private.url_host(p_website_domain);
    if v_domain is null then
      raise exception 'invalid_domain' using errcode = '22023';
    end if;
    -- A site already answers on this domain: connecting is the right choice.
    if exists (
      select 1 from public.websites w
      where v_domain = any (private.website_hosts(w.primary_domain, w.allowed_origins))
    ) then
      raise exception 'domain_taken' using errcode = 'PT409';
    end if;
  end if;

  v_slug := trim(both '-' from left(trim(both '-' from regexp_replace(lower(
    translate(v_org_name, 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')),
    '[^a-z0-9]+', '-', 'g')), 40));
  if v_slug = '' then v_slug := 'client'; end if;
  if exists (select 1 from public.organizations where slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
  end if;
  insert into public.organizations (slug, name, created_by)
  values (v_slug, v_org_name, auth.uid())
  returning id into v_org;

  if v_domain is not null or nullif(btrim(coalesce(p_website_name, '')), '') is not null then
    v_site_name := coalesce(private.check_text(nullif(btrim(coalesce(p_website_name, '')), ''), 120, 'website name'), v_domain, v_org_name);
    insert into public.websites (organization_id, name, primary_domain, status, allowed_origins)
    values (v_org, v_site_name, v_domain, 'draft',
      case when v_domain is null then '{}'::text[]
           else private.normalize_origins(array['https://' || v_domain, 'https://www.' || v_domain]) end)
    returning id into v_site_id;
    v_site_domain := v_domain;
  end if;

  v_role := 'owner';
  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, p_user_id, v_role);
  update public.access_requests
  set status = 'approved', organization_id = v_org, website_id = v_site_id,
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where user_id = p_user_id;

  perform private.hq_log('organization.created', 'organization', v_org::text,
    jsonb_build_object('source', 'access_request', 'user_id', p_user_id, 'website_id', v_site_id));
  perform private.hq_log('access_request.approved', 'access_request', p_user_id::text,
    jsonb_build_object('mode', 'create', 'organization_id', v_org, 'website_id', v_site_id, 'role', v_role));

  return jsonb_build_object('status', 'approved', 'mode', 'create', 'organization_id', v_org,
    'organization_name', v_org_name, 'website_id', v_site_id, 'website_name', v_site_name,
    'website_domain', v_site_domain, 'role', v_role, 'email', v_email, 'locale', v_locale,
    'archived_organization_id', null, 'unchanged', false);
end;
$$;

revoke all on function public.admin_review_access_request(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_review_access_request(uuid, text, text, text, text, text, text, text) to authenticated;

-- @part 4: old signature, kept working ----------------------------------------------

-- Same signature as before. Decline delegates; approve needs an organization and
-- connects to its first website (the caller chose that organization explicitly).
-- Without an organization it refuses: an organization is never created silently.
create or replace function public.review_access_request(
  p_user_id uuid, p_approve boolean, p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text;
begin
  perform private.assert_platform_admin();
  if not p_approve then
    return public.admin_review_access_request(p_user_id, 'reject');
  end if;
  if p_organization_id is null then
    raise exception 'choose_site_or_create' using errcode = 'PT409',
      hint = 'Use admin_review_access_request with p_mode connect (website id) or create.';
  end if;
  select w.id into v_site
  from public.websites w
  where w.organization_id = p_organization_id and w.status <> 'archived'
  order by w.created_at, w.id
  limit 1;
  if v_site is null then
    raise exception 'website_not_found' using errcode = 'PT404';
  end if;
  return public.admin_review_access_request(p_user_id, 'connect', v_site, null, v_site);
end;
$$;

revoke all on function public.review_access_request(uuid, boolean, uuid) from public, anon;
grant execute on function public.review_access_request(uuid, boolean, uuid) to authenticated;
