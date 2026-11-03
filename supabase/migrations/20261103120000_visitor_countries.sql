-- Visitor countries for the analytics maps (client dashboard and HQ).
--
-- Privacy: only the two-letter country of a visit is kept, read from the
-- edge network's own header (x-lu-client-country relayed by the LevelUp API,
-- else Cloudflare's cf-ipcountry or Vercel's x-vercel-ip-country). No IP, no
-- city, no identifier; daily counters per website and country, like the rest
-- of site analytics. Unknown / anonymised countries (XX, T1, ZZ) are skipped.

create table if not exists public.site_countries_daily (
  website_id text not null references public.websites (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  country text not null check (country ~ '^[A-Z]{2}$'),
  views integer not null default 0,
  visitors integer not null default 0,
  primary key (website_id, day, country)
);
create index if not exists site_countries_daily_org_day_idx on public.site_countries_daily (organization_id, day);
alter table public.site_countries_daily enable row level security;
revoke all on public.site_countries_daily from anon, authenticated;
grant select on public.site_countries_daily to authenticated;
drop policy if exists site_countries_daily_member_read on public.site_countries_daily;
create policy site_countries_daily_member_read on public.site_countries_daily
  for select to authenticated using (private.has_org_role(organization_id, 'viewer'));

-- Where the organization is based (ISO 3166-1 alpha-2), for the HQ clients map.
alter table public.organizations add column if not exists country text
  check (country is null or country ~ '^[A-Z]{2}$');

-- track_pageview: also count the visit's country. The function is patched in
-- place (same body, two insertions) so the rest of its logic stays identical.
do $do$
declare
  d text := pg_get_functiondef('public.track_pageview(text,text,text,text)'::regprocedure);
begin
  if position('site_countries_daily' in d) > 0 then
    return; -- already patched
  end if;
  if (length(d) - length(replace(d, '  return true;' || chr(10) || 'end;', ''))) <> length('  return true;' || chr(10) || 'end;') then
    raise exception 'track_pageview: unexpected body, not patched';
  end if;
  d := regexp_replace(d, 'declare\n', 'declare' || chr(10) || '  v_country text;' || chr(10));
  d := replace(d, '  return true;' || chr(10) || 'end;', $ins$  v_country := upper(left(coalesce(nullif(v_headers ->> 'x-lu-client-country', ''),
                                    nullif(v_headers ->> 'cf-ipcountry', ''),
                                    v_headers ->> 'x-vercel-ip-country', ''), 2));
  if v_country ~ '^[A-Z]{2}$' and v_country not in ('XX', 'T1', 'ZZ') then
    insert into public.site_countries_daily as c (website_id, organization_id, day, country, views, visitors)
    values (p_website_id, v_org, v_day, v_country, 1, case when v_new_visitor then 1 else 0 end)
    on conflict (website_id, day, country) do update
      set views = c.views + 1, visitors = c.visitors + case when v_new_visitor then 1 else 0 end;
  end if;
  return true;
end;$ins$);
  execute d;
end;
$do$;

-- Client dashboard: visitors per country of one website (RLS: members only).
create or replace function public.site_analytics_countries(p_website_id text, p_days integer default 30)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('country', country, 'views', views, 'visitors', visitors)
                            order by views desc), '[]'::jsonb)
  from (
    select country, sum(views)::int as views, sum(visitors)::int as visitors
    from public.site_countries_daily
    where website_id = p_website_id
      and day >= (now() at time zone 'America/Toronto')::date - (least(greatest(coalesce(p_days, 30), 1), 366) - 1)
    group by country
    order by sum(views) desc
    limit 250
  ) x;
$$;
revoke all on function public.site_analytics_countries(text, integer) from public, anon;
grant execute on function public.site_analytics_countries(text, integer) to authenticated;

-- HQ: visitors of the whole ecosystem per country, and clients per country
-- and sector (website type). Any HQ role with overview.read; counts only.
create or replace function public.hq_geo_overview(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 366);
  v_from date := (now() at time zone 'America/Toronto')::date - (v_days - 1);
begin
  perform private.hq_assert('overview.read');
  return jsonb_build_object(
    'days', v_days,
    'visitors', coalesce((
      select jsonb_agg(jsonb_build_object('country', country, 'views', views, 'visitors', visitors) order by views desc)
      from (
        select country, sum(views)::int as views, sum(visitors)::int as visitors
        from public.site_countries_daily where day >= v_from
        group by country
      ) v
    ), '[]'::jsonb),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object('country', country, 'clients', clients, 'sectors', sectors) order by clients desc)
      from (
        select coalesce(o.country, '') as country, count(distinct o.id)::int as clients,
               coalesce(jsonb_agg(distinct w.site_type) filter (where w.site_type is not null), '[]'::jsonb) as sectors
        from public.organizations o
        left join public.websites w on w.organization_id = o.id and w.status <> 'archived'
        where o.status = 'active'
        group by coalesce(o.country, '')
      ) c
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.hq_geo_overview(integer) from public, anon;
grant execute on function public.hq_geo_overview(integer) to authenticated;
