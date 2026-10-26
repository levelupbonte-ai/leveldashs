-- LevelUp sees what its own websites receive, in the same adaptive dashboard.
--
-- The showcase site (levelup-ecosystem.com) receives "Start a project"
-- requests (public.project_requests, with the AI triage) and LevelStudio
-- (studio.levelup-ecosystem.com) has its usage. Those tables are not
-- tenant tables (no website_id), so members of the owning organization read
-- them through SECURITY DEFINER functions gated by a website feature:
--
-- - project_requests: list / stats / status + notes (owner, admin)
-- - studio_insights:  aggregate LevelStudio usage (counts only, no person)
--
-- Every function checks that the caller is a member of the organization that
-- owns the website and that the session satisfies MFA (aal2 when the user
-- has a second factor), like the other sensitive dashboard reads.

insert into public.features (key, name, description)
values
  ('project_requests', 'Project requests', 'Start a project requests with the AI triage'),
  ('studio_insights', 'LevelStudio insights', 'Aggregate LevelStudio usage: projects, creators, generations')
on conflict (key) do nothing;

insert into public.website_features (website_id, organization_id, feature_key)
select w.id, w.organization_id, 'project_requests'
from public.websites w where w.primary_domain = 'levelup-ecosystem.com'
on conflict (website_id, feature_key) do nothing;

insert into public.website_features (website_id, organization_id, feature_key)
select w.id, w.organization_id, 'studio_insights'
from public.websites w where w.primary_domain = 'studio.levelup-ecosystem.com'
on conflict (website_id, feature_key) do nothing;

-- Organization of the website when the caller may read p_feature on it
-- (member with p_min_role, MFA satisfied, feature enabled); null otherwise.
create or replace function private.owned_source_org(p_website_id text, p_feature text, p_min_role text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.organization_id
  from public.websites w
  where w.id = p_website_id
    and w.status <> 'archived'
    and private.website_has_feature(w.id, p_feature)
    and private.has_org_role(w.organization_id, p_min_role)
    and private.mfa_satisfied();
$$;

revoke all on function private.owned_source_org(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- project requests

create or replace function public.site_project_requests_list(
  p_website_id text,
  p_status text[] default null,
  p_verdict text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.owned_source_org(p_website_id, 'project_requests', 'viewer');
  v_pii boolean;
  v_q text;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_total bigint;
  v_rows jsonb;
begin
  if v_org is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_pii := private.has_org_role(v_org, 'editor');
  v_q := nullif(private.clean_line(p_search, 100), '');
  if v_q is not null then
    v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with filtered as (
    select r.*, h.created_at as handoff_at, h.claimed_at, h.open_count
    from public.project_requests r
    left join private.project_handoffs h on h.request_id = r.id
    where (p_status is null or cardinality(p_status) = 0 or r.status = any (p_status))
      and (p_verdict is null or r.ai_verdict = p_verdict)
      and (v_q is null or r.business_name ilike v_q or r.project_type ilike v_q
        or r.sector ilike v_q or r.ai_summary ilike v_q
        or (v_pii and (r.name ilike v_q or r.email ilike v_q or r.phone ilike v_q)))
  )
  select (select count(*) from filtered),
         coalesce((select jsonb_agg(jsonb_build_object(
           'id', f.id, 'created_at', f.created_at, 'locale', f.locale,
           'name', case when v_pii then f.name else private.mask_name(f.name) end,
           'email', case when v_pii then f.email else private.mask_email(f.email) end,
           'phone', case when v_pii then f.phone else null end,
           'business_name', f.business_name, 'has_business', f.has_business,
           'business_stage', f.business_stage, 'sector', f.sector, 'business_age', f.business_age,
           'website', f.website, 'social_links', to_jsonb(coalesce(f.social_links, '{}'::text[])),
           'budget', f.budget, 'timeline', f.timeline, 'project_type', f.project_type,
           'brief', case when v_pii then f.brief else null end,
           'ai_score', f.ai_score, 'ai_verdict', f.ai_verdict, 'ai_summary', f.ai_summary,
           'ai_reasons', f.ai_reasons, 'ai_red_flags', f.ai_red_flags,
           'status', f.status, 'notes', case when v_pii then f.notes else null end,
           'reviewed_at', f.reviewed_at,
           'handoff', case when f.handoff_at is null then null else jsonb_build_object(
             'created_at', f.handoff_at, 'claimed_at', f.claimed_at, 'open_count', f.open_count) end,
           'masked', not v_pii)
           order by f.created_at desc)
           from (select * from filtered order by created_at desc limit v_limit offset v_offset) f),
           '[]'::jsonb)
  into v_total, v_rows;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'pii', v_pii,
    'can_edit', private.has_org_role(v_org, 'admin'));
end;
$$;

-- Counts for the overview (null when the caller may not read them).
create or replace function public.site_project_requests_stats(p_website_id text, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.owned_source_org(p_website_id, 'project_requests', 'viewer');
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 366));
begin
  if v_org is null then
    return null;
  end if;
  return (select jsonb_build_object(
    'total', count(*),
    'new', count(*) filter (where status = 'new'),
    'in_range', count(*) filter (where created_at >= v_from),
    'qualified', count(*) filter (where ai_verdict = 'qualified' and created_at >= v_from),
    'review', count(*) filter (where ai_verdict = 'review' and created_at >= v_from),
    'rejected', count(*) filter (where ai_verdict = 'rejected' and created_at >= v_from),
    'average_score', round(avg(ai_score) filter (where created_at >= v_from)),
    'won', count(*) filter (where status = 'won'),
    'handoffs_claimed', (select count(*) from private.project_handoffs where claimed_at is not null))
    from public.project_requests);
end;
$$;

-- Owner / admin: status and private notes, audited.
create or replace function public.site_update_project_request(
  p_website_id text,
  p_id uuid,
  p_status text default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.owned_source_org(p_website_id, 'project_requests', 'admin');
  v_notes text;
begin
  if v_org is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_mfa();
  if p_status is not null and p_status not in ('new', 'contacted', 'demo', 'won', 'lost', 'rejected') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  v_notes := private.check_text(p_notes, 4000, 'notes', true);
  update public.project_requests
  set status = coalesce(p_status, status),
      notes = case when p_notes is null then notes else v_notes end,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_id;
  if not found then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  perform private.site_audit(p_website_id, v_org, 'project_request.updated', p_id::text,
    jsonb_strip_nulls(jsonb_build_object('status', p_status, 'notes_changed', p_notes is not null)));
end;
$$;

-- ---------------------------------------------------------------- LevelStudio

-- Aggregate usage of LevelStudio (no person, no content), null when the
-- caller may not read it.
create or replace function public.site_studio_summary(p_website_id text, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.owned_source_org(p_website_id, 'studio_insights', 'viewer');
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 366);
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_from timestamptz;
begin
  if v_org is null then
    return null;
  end if;
  v_from := ((v_today - (v_days - 1))::timestamp) at time zone 'America/Toronto';
  return jsonb_build_object(
    'projects_total', (select count(*) from public.studio_projects),
    'projects_in_range', (select count(*) from public.studio_projects where created_at >= v_from),
    'creators_total', (select count(distinct coalesce(user_id::text, owner_anon_id)) from public.studio_projects),
    'creators_in_range', (select count(distinct coalesce(user_id::text, owner_anon_id))
                          from public.studio_projects where created_at >= v_from),
    'signed_in_creators', (select count(distinct user_id) from public.studio_projects where user_id is not null),
    'shared', (select count(*) from public.studio_projects where share_token is not null),
    'generations_in_range', (select coalesce(sum(used), 0) from public.studio_usage
                             where subject like 'owner:%' and day >= v_today - (v_days - 1)),
    'series', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'count', n) order by d) from (
        select (created_at at time zone 'America/Toronto')::date as d, count(*) as n
        from public.studio_projects where created_at >= v_from group by 1) s), '[]'::jsonb),
    'frameworks', coalesce((select jsonb_agg(jsonb_build_object('framework', f, 'count', n) order by n desc) from (
        select coalesce(framework, '') as f, count(*) as n from public.studio_projects
        group by 1 order by 2 desc limit 6) s), '[]'::jsonb),
    'handoffs', (select count(*) from private.project_handoffs),
    'handoffs_claimed', (select count(*) from private.project_handoffs where claimed_at is not null)
  );
end;
$$;

-- Counts used by site_capabilities (zeros when the caller may not read them).
create or replace function public.site_owned_source_counts(p_website_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'project_requests', case when private.owned_source_org(p_website_id, 'project_requests', 'viewer') is null
      then 0 else (select count(*) from public.project_requests) end,
    'studio_projects', case when private.owned_source_org(p_website_id, 'studio_insights', 'viewer') is null
      then 0 else (select count(*) from public.studio_projects) end);
$$;

-- Latest project requests for the activity bell (no contact details).
create or replace function public.site_owned_activity(p_website_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(a), '[]'::jsonb) from (
    select jsonb_build_object('kind', 'project_request', 'id', r.id, 'at', r.created_at,
      'label', coalesce(r.project_type, ''), 'title', coalesce(r.business_name, ''),
      'status', r.status, 'rating', r.ai_score) as a
    from public.project_requests r
    where private.owned_source_org(p_website_id, 'project_requests', 'viewer') is not null
    order by r.created_at desc
    limit 20
  ) x;
$$;

revoke all on function public.site_project_requests_list(text, text[], text, text, integer, integer) from public, anon;
revoke all on function public.site_project_requests_stats(text, integer) from public, anon;
revoke all on function public.site_update_project_request(text, uuid, text, text) from public, anon;
revoke all on function public.site_studio_summary(text, integer) from public, anon;
revoke all on function public.site_owned_source_counts(text) from public, anon;
revoke all on function public.site_owned_activity(text) from public, anon;
grant execute on function public.site_project_requests_list(text, text[], text, text, integer, integer) to authenticated;
grant execute on function public.site_project_requests_stats(text, integer) to authenticated;
grant execute on function public.site_update_project_request(text, uuid, text, text) to authenticated;
grant execute on function public.site_studio_summary(text, integer) to authenticated;
grant execute on function public.site_owned_source_counts(text) to authenticated;
grant execute on function public.site_owned_activity(text) to authenticated;
