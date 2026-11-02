-- LevelStudio in the LevelUp staff area: the template catalog (studio_templates) and the
-- sites people generate (studio_projects), for platform admins on an aal2 session only.
--
-- No table access is granted to anyone: staff read through the SECURITY DEFINER functions
-- below, each of which calls private.assert_platform_admin() (platform admin + aal2) and
-- writes hq_audit_log. Every list and preview call is audited as `studio.viewed`;
-- revealing a creator's e-mail is audited as `studio.creator_email_viewed`; publishing
-- is audited as `studio.template_published` / `studio.template_unpublished`.
--
-- LevelStudio's server upserts its built-in templates with is_published = true on every
-- cold start. A staff decision is kept in private.studio_template_publication and a
-- trigger re-applies it on those upserts, so unpublishing sticks.
--
-- Nothing here changes data: one table, one trigger and functions are added.

-- @part 1: staff publication decisions ----------------------------------------------------

create table if not exists private.studio_template_publication (
  template_id text primary key references public.studio_templates (id) on delete cascade,
  is_published boolean not null,
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now()
);
alter table private.studio_template_publication enable row level security;
revoke all on table private.studio_template_publication from public, anon, authenticated;

create or replace function private.studio_templates_keep_staff_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_published boolean;
begin
  select o.is_published into v_published
  from private.studio_template_publication o where o.template_id = new.id;
  if found then
    new.is_published := v_published;
  end if;
  return new;
end;
$$;
revoke all on function private.studio_templates_keep_staff_publication() from public, anon, authenticated;

drop trigger if exists studio_templates_keep_staff_publication on public.studio_templates;
create trigger studio_templates_keep_staff_publication
  before update of is_published on public.studio_templates
  for each row execute function private.studio_templates_keep_staff_publication();

-- @part 2: templates -----------------------------------------------------------------------

-- The catalog: starter / style templates and people's imports (owner e-mail masked).
create or replace function public.admin_studio_templates()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform private.assert_platform_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'kind', t.kind,
      'tagline', t.tagline,
      'service', t.service,
      'accent', t.accent,
      'palette', to_jsonb(coalesce(t.palette, '{}'::text[])),
      'is_published', t.is_published,
      'has_html', coalesce(octet_length(t.html), 0) > 0,
      'owner_email_masked', case when t.kind = 'import' then private.hq_mask_email(u.email) end,
      'owner_is_visitor', t.kind = 'import' and t.owner_user_id is null,
      'uses', (select count(*) from public.studio_projects p where p.template_id = t.id),
      'created_at', t.created_at,
      'updated_at', t.updated_at)
    order by (t.kind = 'import'), t.kind, t.sort_order, t.name), '[]'::jsonb)
  into v_rows
  from public.studio_templates t
  left join auth.users u on u.id = t.owner_user_id;

  perform private.hq_log('studio.viewed', null, null,
    jsonb_build_object('list', 'templates', 'count', jsonb_array_length(v_rows)));
  return v_rows;
end;
$$;

-- One template's stored HTML, for the sandboxed preview.
create or replace function public.admin_studio_template_preview(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.studio_templates;
begin
  perform private.assert_platform_admin();
  select * into v_t from public.studio_templates where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  perform private.hq_log('studio.viewed', 'studio_template', v_t.id,
    jsonb_build_object('preview', 'template'));
  return jsonb_build_object('id', v_t.id, 'name', v_t.name, 'html', v_t.html);
end;
$$;

-- Publish / unpublish a starter or style template (imports are private to their owner).
create or replace function public.admin_studio_set_template_published(p_id text, p_published boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.studio_templates;
begin
  perform private.assert_platform_admin();
  if p_published is null then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  select * into v_t from public.studio_templates where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if v_t.kind not in ('starter', 'style') then
    raise exception 'not_publishable' using errcode = '22023';
  end if;
  insert into private.studio_template_publication (template_id, is_published, set_by)
  values (v_t.id, p_published, auth.uid())
  on conflict (template_id) do update
    set is_published = excluded.is_published, set_by = excluded.set_by, set_at = now();
  if v_t.is_published is distinct from p_published then
    update public.studio_templates set is_published = p_published where id = v_t.id;
  end if;
  perform private.hq_log(
    case when p_published then 'studio.template_published' else 'studio.template_unpublished' end,
    'studio_template', v_t.id,
    jsonb_build_object('name', v_t.name, 'kind', v_t.kind, 'was_published', v_t.is_published));
  return jsonb_build_object('id', v_t.id, 'is_published', p_published);
end;
$$;

-- @part 3: sites created ---------------------------------------------------------------------

-- Paginated, searchable list (title or creator e-mail). Creator e-mail masked; no HTML.
-- status: 'shared' = a share link that has not expired, otherwise 'draft'.
create or replace function public.admin_studio_projects(
  p_search text default null,
  p_status text default null,
  p_page integer default 1,
  p_per_page integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(left(coalesce(p_search, ''), 100)), '');
  v_like text;
  v_page integer := greatest(1, least(coalesce(p_page, 1), 5000));
  v_per integer := case when p_per_page in (10, 20, 50) then p_per_page else 20 end;
  v_total integer;
  v_rows jsonb;
  v_counts jsonb;
begin
  perform private.assert_platform_admin();
  if p_status is not null and p_status not in ('draft', 'shared') then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select jsonb_build_object(
      'all', count(*),
      'shared', count(*) filter (where p.share_token is not null
        and (p.share_expires_at is null or p.share_expires_at > now())))
  into v_counts
  from public.studio_projects p;

  with matched as (
    select p.id, p.updated_at,
      (p.share_token is not null and (p.share_expires_at is null or p.share_expires_at > now())) as shared
    from public.studio_projects p
    left join auth.users u on u.id = p.user_id
    where v_search is null or p.title ilike v_like or u.email ilike v_like
  ), filtered as (
    select * from matched
    where p_status is null or (p_status = 'shared') = shared
  ), paged as (
    select f.id, f.shared, f.updated_at from filtered f
    order by f.updated_at desc, f.id
    limit v_per offset (v_page - 1) * v_per
  )
  select (select count(*) from filtered),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'created_at', p.created_at,
      'updated_at', p.updated_at,
      'versions', greatest(
        (select count(*) from jsonb_array_elements(
            case when jsonb_typeof(p.messages) = 'array' then p.messages else '[]'::jsonb end) m
          where m ->> 'role' = 'assistant' and m ->> 'kind' = 'site' and coalesce(m ->> 'html', '') <> ''),
        case when coalesce(octet_length(p.html), 0) > 0 then 1 else 0 end),
      'creator_email_masked', private.hq_mask_email(u.email),
      'creator_has_account', p.user_id is not null,
      'status', case when pg.shared then 'shared' else 'draft' end,
      'share_path', case when pg.shared then '/p/' || p.share_token end,
      'share_expires_at', case when pg.shared then p.share_expires_at end,
      'generating', coalesce(p.generating, false),
      'archived', p.archived_at is not null,
      'has_html', coalesce(octet_length(p.html), 0) > 0,
      'template_name', t.name)
      order by pg.updated_at desc, pg.id), '[]'::jsonb)
  into v_total, v_rows
  from paged pg
  join public.studio_projects p on p.id = pg.id
  left join auth.users u on u.id = p.user_id
  left join public.studio_templates t on t.id = p.template_id;

  perform private.hq_log('studio.viewed', null, null,
    jsonb_build_object('list', 'projects', 'page', v_page, 'per_page', v_per,
      'status', p_status, 'searched', v_search is not null, 'count', jsonb_array_length(v_rows)));
  return jsonb_build_object('total', coalesce(v_total, 0), 'page', v_page, 'per_page', v_per,
    'rows', v_rows, 'counts', v_counts);
end;
$$;

-- One site's current HTML, for the sandboxed preview (never edited from here).
create or replace function public.admin_studio_project_preview(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.studio_projects;
begin
  perform private.assert_platform_admin();
  select * into v_p from public.studio_projects where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  perform private.hq_log('studio.viewed', 'studio_project', v_p.id::text,
    jsonb_build_object('preview', 'project'));
  return jsonb_build_object('id', v_p.id, 'title', v_p.title, 'html', v_p.html);
end;
$$;

-- The creator's full e-mail, on purpose and audited.
create or replace function public.admin_studio_creator_email(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_email text;
begin
  perform private.assert_platform_admin();
  select p.user_id into v_user from public.studio_projects p where p.id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  select u.email into v_email from auth.users u where u.id = v_user;
  perform private.hq_log('studio.creator_email_viewed', 'studio_project', p_id::text, '{}'::jsonb);
  return jsonb_build_object('email', v_email);
end;
$$;

-- @part 4: grants ---------------------------------------------------------------------------

revoke all on function public.admin_studio_templates() from public, anon;
revoke all on function public.admin_studio_template_preview(text) from public, anon;
revoke all on function public.admin_studio_set_template_published(text, boolean) from public, anon;
revoke all on function public.admin_studio_projects(text, text, integer, integer) from public, anon;
revoke all on function public.admin_studio_project_preview(uuid) from public, anon;
revoke all on function public.admin_studio_creator_email(uuid) from public, anon;
grant execute on function public.admin_studio_templates() to authenticated;
grant execute on function public.admin_studio_template_preview(text) to authenticated;
grant execute on function public.admin_studio_set_template_published(text, boolean) to authenticated;
grant execute on function public.admin_studio_projects(text, text, integer, integer) to authenticated;
grant execute on function public.admin_studio_project_preview(uuid) to authenticated;
grant execute on function public.admin_studio_creator_email(uuid) to authenticated;
