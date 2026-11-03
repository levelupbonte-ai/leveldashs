-- Logs on both sides + the HQ AI space.
--
-- 1. Every content change a signed-in person makes on a client site (settings,
--    texts, services, FAQ, gallery, team, reviews, announcements, media) is
--    written to site_audit_log, next to the existing campaign / portal / key
--    entries. Saves of the same item by the same person within 2 minutes count
--    once (autosave would flood the log).
-- 2. Client dashboard: site_activity_log() — who in the team did what (owners
--    and admins, like the table's read policy). LevelUp staff show as
--    "LevelUp", never with their e-mail.
-- 3. HQ: hq_list_site_activity() — the same log across all clients (masked
--    e-mails without pii.read) and hq_ai_overview() — AI calls per app, model,
--    client and the health of the provider keys (never the keys themselves).

create index if not exists site_audit_log_org_idx on public.site_audit_log (organization_id, created_at desc);
create index if not exists site_audit_log_created_idx on public.site_audit_log (created_at desc);

create or replace function private.audit_content_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_uid uuid := (select auth.uid());
  v_site text := v_row ->> 'website_id';
  v_org uuid := (v_row ->> 'organization_id')::uuid;
  v_target text := coalesce(v_row ->> 'id', v_row ->> 'key');
  v_action text := 'content.' || case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end;
  v_label text := left(coalesce(v_row ->> 'key', v_row ->> 'name', v_row ->> 'title', v_row ->> 'question',
                                v_row ->> 'original_name', v_row ->> 'file_name', v_row ->> 'section', ''), 80);
begin
  -- Only people (not the public tag, cron jobs or migrations), on a site.
  if v_uid is null or v_site is null or v_org is null then
    return null;
  end if;
  -- A site or client being deleted takes its rows with it: nothing to log.
  if not exists (select 1 from public.websites w where w.id = v_site and w.organization_id = v_org) then
    return null;
  end if;
  if exists (
    select 1 from public.site_audit_log l
    where l.website_id = v_site and l.actor_id = v_uid and l.action = v_action
      and l.target_id is not distinct from v_target
      and l.metadata ->> 'area' = tg_table_name
      and l.created_at > now() - interval '2 minutes'
  ) then
    return null;
  end if;
  perform private.site_audit(v_site, v_org, v_action, v_target,
    jsonb_build_object('area', tg_table_name, 'label', nullif(v_label, '')));
  return null;
end;
$$;
revoke all on function private.audit_content_change() from public, anon, authenticated;

do $do$
declare
  t text;
begin
  foreach t in array array['website_settings', 'content_blocks', 'services', 'faq_items', 'gallery_items',
                           'team_members', 'reviews', 'announcements', 'media'] loop
    execute format('drop trigger if exists audit_content_change on public.%I', t);
    execute format('create trigger audit_content_change after insert or update or delete on public.%I
                    for each row execute function private.audit_content_change()', t);
  end loop;
end;
$do$;

-- Client dashboard: the site's activity log (owners and admins).
create or replace function public.site_activity_log(p_website_id text, p_page integer default 1, p_per_page integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_per integer := least(greatest(coalesce(p_per_page, 50), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
begin
  select w.organization_id into v_org from public.websites w where w.id = p_website_id;
  if v_org is null or not private.has_org_role(v_org, 'admin') then
    raise exception 'Not allowed' using errcode = 'PT403';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.site_audit_log l where l.website_id = p_website_id),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'created_at', l.created_at, 'action', l.action,
               'area', l.metadata ->> 'area', 'label', l.metadata ->> 'label',
               'actor', case
                 when l.actor_id is null then null
                 when exists (select 1 from public.organization_members m
                              where m.organization_id = v_org and m.user_id = l.actor_id)
                   then (select u.email from auth.users u where u.id = l.actor_id)
                 else 'LevelUp'
               end)
             order by l.created_at desc)
      from (select * from public.site_audit_log l
            where l.website_id = p_website_id
            order by l.created_at desc
            offset (v_page - 1) * v_per limit v_per) l), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.site_activity_log(text, integer, integer) from public, anon;
grant execute on function public.site_activity_log(text, integer, integer) to authenticated;

-- HQ: client activity across all clients.
create or replace function public.hq_list_site_activity(p_search text default null, p_page integer default 1, p_per_page integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_per integer := least(greatest(coalesce(p_per_page, 50), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.hq_assert('clients.read');
  return (
    with f as (
      select l.*, o.name as org_name
      from public.site_audit_log l
      join public.organizations o on o.id = l.organization_id
      where v_q is null
         or o.name ilike '%' || v_q || '%'
         or l.website_id ilike '%' || v_q || '%'
         or l.action ilike '%' || v_q || '%'
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', x.id, 'created_at', x.created_at, 'action', x.action,
                 'organization', x.org_name, 'website_id', x.website_id,
                 'area', x.metadata ->> 'area', 'label', x.metadata ->> 'label',
                 'actor', private.hq_pii((select u.email from auth.users u where u.id = x.actor_id), 'email'))
               order by x.created_at desc)
        from (select * from f order by f.created_at desc offset (v_page - 1) * v_per limit v_per) x), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.hq_list_site_activity(text, integer, integer) from public, anon;
grant execute on function public.hq_list_site_activity(text, integer, integer) to authenticated;

-- HQ: AI usage.
create or replace function public.hq_ai_overview(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90));
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
begin
  perform private.hq_assert('ai.read');
  return jsonb_build_object(
    'days', v_days,
    'total', (select count(*) from public.ai_calls c where c.created_at > v_since),
    'today', (select count(*) from public.ai_calls c where c.created_at > date_trunc('day', now())),
    'by_app', coalesce((
      select jsonb_agg(jsonb_build_object('app', x.app, 'calls', x.n) order by x.n desc)
      from (select c.app, count(*) as n from public.ai_calls c where c.created_at > v_since group by c.app) x), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'calls', coalesce(x.n, 0)) order by d.day)
      from generate_series((now() - make_interval(days => v_days - 1))::date, now()::date, interval '1 day') as d(day)
      left join (select c.created_at::date as day, count(*) as n from public.ai_calls c
                 where c.created_at > v_since group by 1) x on x.day = d.day::date), '[]'::jsonb),
    'by_model', coalesce((
      select jsonb_agg(jsonb_build_object(
               'provider', x.provider, 'model', x.model, 'label', coalesce(m.label, x.model),
               'tier', m.tier, 'calls', x.n, 'tasks', x.tasks, 'last_used', x.last_used)
             order by x.n desc)
      from (select c.provider, c.model, count(*) as n, array_agg(distinct c.task) as tasks, max(c.created_at) as last_used
            from public.ai_calls c where c.created_at > v_since group by c.provider, c.model) x
      left join public.ai_models m on m.provider = x.provider and m.model = x.model), '[]'::jsonb),
    'by_client', coalesce((
      select jsonb_agg(jsonb_build_object(
               'organization_id', x.organization_id, 'name', o.name, 'calls', x.n, 'month', x.month,
               'month_limit', private.plan_limit(x.organization_id, 'assistant_requests_month'))
             order by x.n desc)
      from (select u.organization_id,
                   sum(u.count) filter (where u.day >= v_since::date) as n,
                   sum(u.count) filter (where u.day >= v_month) as month
            from public.ai_usage u
            where u.day >= least(v_since::date, v_month)
            group by u.organization_id
            order by 2 desc nulls last
            limit 50) x
      join public.organizations o on o.id = x.organization_id), '[]'::jsonb),
    'keys', coalesce((
      select jsonb_agg(jsonb_build_object(
               'provider', k.provider, 'keys', k.n, 'invalid', k.invalid, 'exhausted', k.exhausted,
               'cooling', k.cooling, 'success', k.success, 'failure', k.failure, 'last_used', k.last_used)
             order by k.provider)
      from (select s.provider, count(*) as n,
                   count(*) filter (where s.invalid) as invalid,
                   count(*) filter (where s.exhausted_until > now()) as exhausted,
                   count(*) filter (where s.cooldown_until > now()) as cooling,
                   sum(s.success_count) as success, sum(s.failure_count) as failure,
                   max(s.last_used_at) as last_used
            from public.ai_key_state s group by s.provider) k), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.hq_ai_overview(integer) from public, anon;
grant execute on function public.hq_ai_overview(integer) to authenticated;
