-- News for client portals (first: Black Pater's member space). Official
-- government feeds about visas, studies and travel, read once a day by the
-- dashboard (/api/news/refresh), summarized by AI once per article (EN + FR),
-- and shown to each member for the country of their dossier. Countries without
-- a feed get a short list of official links, found by AI once per country and
-- checked before being kept (shared by every member for 30 days).
--
--   news_worker_begin(key)                    dashboard worker (billing key): sources to read
--   news_worker_save(key, source, status, items)   new articles of one source
--   news_guide_save(key, country, links)      official links of one country
--   portal_news(key, session, country, lang)  member: the feed of one country
--   portal_news_guide(key, session, country)  member: cached links, or permission to look them up

-- @part 1: tables -----------------------------------------------------------------

create table if not exists private.news_sources (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  country text not null check (country ~ '^[A-Z]{2}$'),
  name text not null check (char_length(name) between 2 and 120),
  feed_url text not null check (feed_url ~ '^https://[^[:space:]]+$' and char_length(feed_url) <= 600),
  home_url text not null check (home_url ~ '^https://[^[:space:]]+$' and char_length(home_url) <= 600),
  lang text not null default 'en' check (lang in ('en', 'fr')),
  active boolean not null default true,
  last_fetched_at timestamptz,
  last_status text check (char_length(last_status) <= 80),
  last_count integer
);

create table if not exists private.news_items (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references private.news_sources (id) on delete cascade,
  country text not null check (country ~ '^[A-Z]{2}$'),
  url text not null unique check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 800),
  title text not null check (char_length(title) between 3 and 300),
  published_at timestamptz,
  summary_en text check (char_length(summary_en) <= 600),
  summary_fr text check (char_length(summary_fr) <= 600),
  topics text[] not null default '{}',
  important boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists news_items_country_idx on private.news_items (country, coalesce(published_at, created_at) desc);

create table if not exists private.news_guides (
  country text primary key check (country ~ '^[A-Z]{2}$'),
  links jsonb not null default '[]' check (jsonb_typeof(links) = 'array' and pg_column_size(links) <= 8000),
  updated_at timestamptz not null default now()
);

create table if not exists private.news_worker_state (
  id integer primary key default 1 check (id = 1),
  last_run_at timestamptz
);
insert into private.news_worker_state (id) values (1) on conflict do nothing;

revoke all on table private.news_sources, private.news_items, private.news_guides, private.news_worker_state
  from public, anon, authenticated;

-- The first official sources. Each run records whether a feed answered
-- (last_status / last_count), so a wrong address shows up the next day.
insert into private.news_sources (id, country, name, feed_url, home_url, lang) values
  ('ca-ircc-en', 'CA', 'Immigration, Refugees and Citizenship Canada',
   'https://api.io.canada.ca/io-server/gc/news/en/v2?dept=departmentofcitizenshipandimmigration&sort=publishedDate&orderBy=desc&pick=20&format=atom',
   'https://www.canada.ca/en/immigration-refugees-citizenship/news.html', 'en'),
  ('ca-ircc-fr', 'CA', 'Immigration, Réfugiés et Citoyenneté Canada',
   'https://api.io.canada.ca/io-server/gc/news/fr/v2?dept=departmentofcitizenshipandimmigration&sort=publishedDate&orderBy=desc&pick=20&format=atom',
   'https://www.canada.ca/fr/immigration-refugies-citoyennete/nouvelles.html', 'fr'),
  ('gb-ukvi', 'GB', 'UK Visas and Immigration',
   'https://www.gov.uk/government/organisations/uk-visas-and-immigration.atom',
   'https://www.gov.uk/government/organisations/uk-visas-and-immigration', 'en'),
  ('us-travel', 'US', 'U.S. Department of State — Travel advisories',
   'https://travel.state.gov/_res/rss/TAsTWs.xml',
   'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html', 'en'),
  ('us-uscis', 'US', 'U.S. Citizenship and Immigration Services',
   'https://www.uscis.gov/news/rss-feed/23269',
   'https://www.uscis.gov/newsroom/news-releases', 'en'),
  ('fr-service-public', 'FR', 'Service-Public.fr — Étrangers',
   'https://www.service-public.fr/abonnements/rss/actu-actu-etrangers.rss',
   'https://www.service-public.fr/particuliers/actualites', 'fr'),
  ('fr-campus-france', 'FR', 'Campus France',
   'https://www.campusfrance.org/fr/rss.xml',
   'https://www.campusfrance.org/fr/actualites', 'fr'),
  ('be-diplomatie', 'BE', 'SPF Affaires étrangères (Belgique)',
   'https://diplomatie.belgium.be/fr/rss.xml',
   'https://diplomatie.belgium.be/fr', 'fr')
on conflict (id) do nothing;

-- @part 2: the worker (dashboard server, billing key) ---------------------------------

create or replace function public.news_worker_begin(p_key text, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
begin
  perform private.assert_billing_key(p_key);
  select last_run_at into v_last from private.news_worker_state where id = 1 for update;
  -- Once every 5 hours at most, whoever calls (a scheduler, a retry).
  if not coalesce(p_force, false) and v_last is not null and v_last > now() - interval '5 hours' then
    return jsonb_build_object('run', false, 'last_run_at', v_last);
  end if;
  update private.news_worker_state set last_run_at = now() where id = 1;
  return jsonb_build_object(
    'run', true,
    'sources', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'country', s.country,
        'name', s.name, 'feed_url', s.feed_url, 'lang', s.lang) order by s.id)
      from private.news_sources s where s.active), '[]'::jsonb),
    'known', coalesce((select jsonb_agg(i.url) from (select url from private.news_items
      order by created_at desc limit 600) i), '[]'::jsonb));
end;
$$;

create or replace function public.news_worker_save(p_key text, p_source text, p_status text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.news_sources;
  v_item jsonb;
  v_added integer := 0;
  v_topics text[];
begin
  perform private.assert_billing_key(p_key);
  select * into s from private.news_sources where id = p_source;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce(v_item ->> 'url', '') !~ '^https://[^[:space:]]+$' or char_length(v_item ->> 'url') > 800
       or char_length(coalesce(v_item ->> 'title', '')) not between 3 and 300 then
      continue;
    end if;
    select coalesce(array_agg(t), '{}') into v_topics
    from jsonb_array_elements_text(coalesce(v_item -> 'topics', '[]')) t
    where t in ('visa', 'study', 'work', 'travel', 'family', 'fees', 'residence', 'other');
    insert into private.news_items (source_id, country, url, title, published_at, summary_en, summary_fr, topics, important)
    values (s.id, s.country, v_item ->> 'url', v_item ->> 'title',
      case when coalesce(v_item ->> 'published_at', '') ~ '^\d{4}-\d{2}-\d{2}' then (v_item ->> 'published_at')::timestamptz end,
      left(nullif(v_item ->> 'summary_en', ''), 600), left(nullif(v_item ->> 'summary_fr', ''), 600),
      v_topics, coalesce(v_item ->> 'important', '') = 'true')
    on conflict (url) do nothing;
    if found then
      v_added := v_added + 1;
    end if;
  end loop;
  update private.news_sources set last_fetched_at = now(), last_status = left(coalesce(p_status, 'ok'), 80),
    last_count = v_added where id = s.id;
  -- Six months of news is plenty.
  delete from private.news_items where created_at < now() - interval '180 days';
  return jsonb_build_object('added', v_added);
end;
$$;

create or replace function public.news_guide_save(p_key text, p_country text, p_links jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_billing_key(p_key);
  if p_country !~ '^[A-Z]{2}$' or p_links is null or jsonb_typeof(p_links) <> 'array'
     or jsonb_array_length(p_links) > 8 or pg_column_size(p_links) > 8000 then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  insert into private.news_guides (country, links, updated_at) values (p_country, p_links, now())
  on conflict (country) do update set links = excluded.links, updated_at = now();
end;
$$;

-- @part 3: the member's feed ----------------------------------------------------------

create or replace function public.portal_news(p_key text, p_session text, p_country text default null, p_lang text default 'fr')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
  v_country text;
  v_fr boolean := coalesce(p_lang, 'fr') <> 'en';
  v_full boolean;
  v_limit integer;
begin
  c := private.portal_session(p_key, p_session);
  v_country := upper(coalesce(nullif(p_country, ''), c.profile ->> 'destinationCountry', ''));
  if v_country !~ '^[A-Z]{2}$' then
    v_country := null;
  end if;
  -- Members with a paid month see everything; a trial or an ended membership sees a preview.
  v_full := c.member_until is not null and c.member_until > now();
  v_limit := case when v_full then 40 else 3 end;
  return jsonb_build_object(
    'country', v_country,
    'dossier_country', upper(nullif(c.profile ->> 'destinationCountry', '')),
    'access', case when v_full then 'full' else 'preview' end,
    'covered', coalesce((select jsonb_agg(distinct s.country) from private.news_sources s where s.active), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(x order by x.at desc) from (
        select i.id, i.url, i.title, s.name as source, i.topics, i.important,
          coalesce(i.published_at, i.created_at) as at,
          case when v_fr then coalesce(i.summary_fr, i.summary_en) else coalesce(i.summary_en, i.summary_fr) end as summary
        from private.news_items i join private.news_sources s on s.id = i.source_id
        where i.country = v_country and coalesce(i.published_at, i.created_at) > now() - interval '120 days'
        order by coalesce(i.published_at, i.created_at) desc limit v_limit) x), '[]'::jsonb),
    'total', (select count(*) from private.news_items i where i.country = v_country
        and coalesce(i.published_at, i.created_at) > now() - interval '120 days'),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'url', s.home_url))
        from private.news_sources s where s.country = v_country and s.active), '[]'::jsonb),
    'guide', (select g.links from private.news_guides g where g.country = v_country
        and g.updated_at > now() - interval '30 days'));
end;
$$;

-- Official links for a country without a feed: the cached list, or the right
-- to look it up now (paid members, 5 new countries a day).
create or replace function public.portal_news_guide(p_key text, p_session text, p_country text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
  v_links jsonb;
begin
  c := private.portal_session(p_key, p_session);
  if p_country is null or upper(p_country) !~ '^[A-Z]{2}$' then
    raise exception 'invalid_country' using errcode = '22023';
  end if;
  select g.links into v_links from private.news_guides g
  where g.country = upper(p_country) and g.updated_at > now() - interval '30 days';
  if v_links is not null then
    return jsonb_build_object('links', v_links, 'cached', true);
  end if;
  if c.member_until is null or c.member_until <= now() then
    raise exception 'membership_required' using errcode = 'PT402';
  end if;
  perform private.hit_rate_limit('portal_news_guide', c.id::text, 5, interval '1 day');
  return jsonb_build_object('links', null, 'lookup', true);
end;
$$;

-- @part 4: grants ---------------------------------------------------------------------

revoke all on function public.news_worker_begin(text, boolean), public.news_worker_save(text, text, text, jsonb),
  public.news_guide_save(text, text, jsonb), public.portal_news(text, text, text, text),
  public.portal_news_guide(text, text, text) from public;
-- Server-to-server calls without a user session (dashboard worker, client websites' servers).
grant execute on function public.news_worker_begin(text, boolean), public.news_worker_save(text, text, text, jsonb),
  public.news_guide_save(text, text, jsonb), public.portal_news(text, text, text, text),
  public.portal_news_guide(text, text, text) to anon, authenticated;
