-- Privacy-friendly visitor analytics for client websites.
--
-- The LevelUp tag calls public.track_pageview(website, path, referrer, lang)
-- with the publishable key. Nothing personal is stored: no cookie, no IP, no
-- user agent, no raw visitor hash. Only daily counters per website, path,
-- referrer host and language.
--
-- Unique visitors: the database keeps one random salt for the current day
-- (overwritten, never kept, when the day changes) and one 16 KB bit set per
-- website and day (a Bloom filter, reset every day). A visit sets 3 bits
-- derived from sha256(salt, website, ip, user agent); a visit whose bits are
-- all already set is a returning visitor. Bits cannot be turned back into an
-- address, and once the salt is replaced nothing links two days together.
-- Days follow the dashboard time zone (America/Toronto).

create table if not exists public.site_traffic_daily (
  website_id text not null,
  organization_id uuid not null,
  day date not null,
  views integer not null default 0 check (views >= 0),
  visitors integer not null default 0 check (visitors >= 0),
  updated_at timestamptz not null default now(),
  primary key (website_id, day),
  foreign key (website_id, organization_id)
    references public.websites (id, organization_id) on delete cascade
);

create table if not exists public.site_pageviews_daily (
  website_id text not null,
  organization_id uuid not null,
  day date not null,
  path text not null check (char_length(path) between 1 and 200 and left(path, 1) = '/'),
  referrer_host text not null default '' check (char_length(referrer_host) <= 100),
  lang text not null default '' check (lang ~ '^([a-z]{2,3})?$'),
  views integer not null default 0 check (views >= 0),
  unique_visitors integer not null default 0 check (unique_visitors >= 0),
  primary key (website_id, day, path, referrer_host, lang),
  foreign key (website_id, organization_id)
    references public.websites (id, organization_id) on delete cascade
);

create index if not exists site_pageviews_daily_site_day_idx
  on public.site_pageviews_daily (website_id, day);

alter table public.site_traffic_daily enable row level security;
alter table public.site_pageviews_daily enable row level security;
revoke all on public.site_traffic_daily from public, anon, authenticated;
revoke all on public.site_pageviews_daily from public, anon, authenticated;
grant select on public.site_traffic_daily to authenticated;
grant select on public.site_pageviews_daily to authenticated;

drop policy if exists site_traffic_daily_member_read on public.site_traffic_daily;
create policy site_traffic_daily_member_read on public.site_traffic_daily
  for select to authenticated using (private.has_org_role(organization_id, 'viewer'));
drop policy if exists site_pageviews_daily_member_read on public.site_pageviews_daily;
create policy site_pageviews_daily_member_read on public.site_pageviews_daily
  for select to authenticated using (private.has_org_role(organization_id, 'viewer'));

-- Private state (closed to every API role).
create table if not exists private.analytics_salt (
  id smallint primary key default 1 check (id = 1),
  day date not null,
  salt bytea not null
);

create table if not exists private.site_visitor_bloom (
  website_id text primary key references public.websites (id) on delete cascade,
  day date not null,
  bits bytea not null
);

-- Fixed-size rate-limit buckets: 4096 per website, keyed by a salted hash.
create table if not exists private.pageview_buckets (
  website_id text not null references public.websites (id) on delete cascade,
  bucket integer not null check (bucket between 0 and 4095),
  window_start timestamptz not null,
  hits integer not null,
  primary key (website_id, bucket)
);

alter table private.analytics_salt enable row level security;
alter table private.site_visitor_bloom enable row level security;
alter table private.pageview_buckets enable row level security;
revoke all on private.analytics_salt from public, anon, authenticated;
revoke all on private.site_visitor_bloom from public, anon, authenticated;
revoke all on private.pageview_buckets from public, anon, authenticated;

-- ---------------------------------------------------------------- normalisation

-- /Blog/Post-1/?utm=x#top -> /blog/post-1 ; ids, long numbers, tokens and
-- e-mail-like segments become :id ; at most 200 characters.
create or replace function private.normalize_path(p_path text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := coalesce(p_path, '');
  v_parts text[];
  v_out text[] := '{}';
  v_seg text;
begin
  v := left(v, 2000);
  v := regexp_replace(v, '^[A-Za-z][A-Za-z0-9+.-]*://[^/]*', '');
  v := split_part(split_part(v, '#', 1), '?', 1);
  v := lower(v);
  v_parts := string_to_array(v, '/');
  if v_parts is not null then
    foreach v_seg in array v_parts loop
      continue when v_seg = '' or v_seg = '.';
      if v_seg ~ '@'
         or v_seg ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or v_seg ~ '^[0-9]{6,}$'
         or v_seg ~ '^[0-9a-f]{16,}$'
         or (char_length(v_seg) >= 24 and v_seg ~ '[0-9]' and v_seg !~ '-') then
        v_seg := ':id';
      else
        v_seg := regexp_replace(v_seg, '[^a-z0-9._~%:-]', '', 'g');
        continue when v_seg = '';
        v_seg := left(v_seg, 80);
      end if;
      v_out := v_out || v_seg;
      exit when cardinality(v_out) >= 12;
    end loop;
  end if;
  return left('/' || array_to_string(v_out, '/'), 200);
end;
$$;

-- https://www.Google.com/search?q=x -> google.com ; empty when invalid.
create or replace function private.referrer_host(p_referrer text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select h from (
      select regexp_replace(lower(substring(left(coalesce(p_referrer, ''), 2000)
        from '^[A-Za-z][A-Za-z0-9+.-]*://([^/:?#@]+)')), '^www\.', '') as h
    ) x
    where h ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      and char_length(h) <= 100
  ), '');
$$;

-- fr-CA -> fr ; empty when unknown.
create or replace function private.primary_lang(p_lang text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(lower(substring(left(coalesce(p_lang, ''), 35) from '^([A-Za-z]{2,3})(-|_|$)')), '');
$$;

-- Tests and sets the 3 bits of p_key in the website bloom filter of today.
-- Returns true when at least one bit was unset (first visit of the day).
create or replace function private.bloom_add(p_bits bytea, p_key bytea, out bits bytea, out added boolean)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pos integer;
  i integer;
begin
  bits := p_bits;
  added := false;
  for i in 0..2 loop
    v_pos := ((get_byte(p_key, i * 3) * 65536 + get_byte(p_key, i * 3 + 1) * 256
               + get_byte(p_key, i * 3 + 2)) % (octet_length(p_bits) * 8));
    if get_bit(bits, v_pos) = 0 then
      bits := set_bit(bits, v_pos, 1);
      added := true;
    end if;
  end loop;
end;
$$;

revoke all on function private.normalize_path(text) from public, anon, authenticated;
revoke all on function private.referrer_host(text) from public, anon, authenticated;
revoke all on function private.primary_lang(text) from public, anon, authenticated;
revoke all on function private.bloom_add(bytea, bytea) from public, anon, authenticated;

-- ---------------------------------------------------------------- tracking

-- Returns true when the view was counted. Silently false when the website is
-- not live, the browser origin is not one of its allowed origins, the client
-- is a bot, or the rate limit (60 views / 5 minutes per bucket, 200 000 views
-- a day per website) is reached.
create or replace function public.track_pageview(
  p_website_id text,
  p_path text,
  p_referrer text default null,
  p_lang text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers json;
  v_origin text;
  v_allowed text[];
  v_org uuid;
  v_ip text;
  v_ua text;
  v_day date := (now() at time zone 'America/Toronto')::date;
  v_salt bytea;
  v_visitor bytea;
  v_bucket integer;
  v_hits integer;
  v_path text;
  v_ref text;
  v_lang text;
  v_bits bytea;
  v_bday date;
  v_new_visitor boolean;
  v_new_path boolean;
  v_views integer;
begin
  if p_website_id is null or p_website_id !~ '^ws_[a-z0-9]{8,32}$'
     or not private.is_website_live(p_website_id) then
    return false;
  end if;
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_origin := lower(v_headers ->> 'origin');
  select allowed_origins, organization_id into v_allowed, v_org
  from public.websites where id = p_website_id;
  if v_origin is null or cardinality(v_allowed) = 0 or not (v_origin = any (v_allowed)) then
    return false;
  end if;

  v_ua := left(coalesce(v_headers ->> 'user-agent', ''), 400);
  if v_ua = '' or v_ua ~* '(bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|httpclient)' then
    return false;
  end if;
  v_ip := coalesce(v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-real-ip',
                   btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '');

  -- Salt of the day: replaced (the old one is gone) when the day changes.
  insert into private.analytics_salt (id, day, salt)
  values (1, v_day, extensions.gen_random_bytes(32))
  on conflict (id) do update
    set day = excluded.day, salt = excluded.salt
    where private.analytics_salt.day <> excluded.day;
  select salt into v_salt from private.analytics_salt where id = 1;

  v_visitor := extensions.digest(v_salt || convert_to(p_website_id || '|' || v_ip || '|' || v_ua, 'UTF8'), 'sha256');

  -- Rate limit per bucket of visitors.
  v_bucket := (get_byte(v_visitor, 30) * 256 + get_byte(v_visitor, 31)) % 4096;
  insert into private.pageview_buckets as b (website_id, bucket, window_start, hits)
  values (p_website_id, v_bucket, now(), 1)
  on conflict (website_id, bucket) do update
    set window_start = case when b.window_start < now() - interval '5 minutes' then now() else b.window_start end,
        hits = case when b.window_start < now() - interval '5 minutes' then 1 else b.hits + 1 end
  returning hits into v_hits;
  if v_hits > 60 then
    return false;
  end if;
  select views into v_views from public.site_traffic_daily where website_id = p_website_id and day = v_day;
  if coalesce(v_views, 0) >= 200000 then
    return false;
  end if;

  v_path := private.normalize_path(p_path);
  v_ref := private.referrer_host(p_referrer);
  -- Internal navigation is not a referral.
  if v_ref <> '' and v_ref = regexp_replace(regexp_replace(v_origin, '^https?://', ''), '^www\.|:[0-9]+$', '', 'g') then
    v_ref := '';
  end if;
  v_lang := private.primary_lang(p_lang);

  -- At most 500 distinct paths a day per website; the rest is grouped.
  if not exists (select 1 from public.site_pageviews_daily
                 where website_id = p_website_id and day = v_day and path = v_path)
     and (select count(distinct path) from public.site_pageviews_daily
          where website_id = p_website_id and day = v_day) >= 500 then
    v_path := '/(other)';
  end if;

  -- Unique visitors (website, then website + path).
  insert into private.site_visitor_bloom (website_id, day, bits)
  values (p_website_id, v_day, decode(repeat('00', 16384), 'hex'))
  on conflict (website_id) do nothing;
  select day, bits into v_bday, v_bits from private.site_visitor_bloom
  where website_id = p_website_id for update;
  if v_bday <> v_day then
    v_bits := decode(repeat('00', 16384), 'hex');
  end if;
  select b.bits, b.added into v_bits, v_new_visitor from private.bloom_add(v_bits, v_visitor) b;
  select b.bits, b.added into v_bits, v_new_path
  from private.bloom_add(v_bits, extensions.digest(v_visitor || convert_to(v_path, 'UTF8'), 'sha256')) b;
  update private.site_visitor_bloom set day = v_day, bits = v_bits where website_id = p_website_id;

  insert into public.site_traffic_daily as t (website_id, organization_id, day, views, visitors)
  values (p_website_id, v_org, v_day, 1, case when v_new_visitor then 1 else 0 end)
  on conflict (website_id, day) do update
    set views = t.views + 1,
        visitors = t.visitors + case when v_new_visitor then 1 else 0 end,
        updated_at = now();

  insert into public.site_pageviews_daily as p
    (website_id, organization_id, day, path, referrer_host, lang, views, unique_visitors)
  values (p_website_id, v_org, v_day, v_path, v_ref, v_lang, 1, case when v_new_path then 1 else 0 end)
  on conflict (website_id, day, path, referrer_host, lang) do update
    set views = p.views + 1,
        unique_visitors = p.unique_visitors + case when v_new_path then 1 else 0 end;

  return true;
end;
$$;

revoke all on function public.track_pageview(text, text, text, text) from public;
grant execute on function public.track_pageview(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- reading

-- Series, totals (with the previous period) and the top pages, referrers and
-- languages of the last p_days days. Members only (RLS on the tables).
create or replace function public.site_analytics_summary(p_website_id text, p_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 366);
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_from date;
  v_prev date;
begin
  v_from := v_today - (v_days - 1);
  v_prev := v_today - (2 * v_days - 1);
  return jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'to', v_today,
    'has_data', exists (select 1 from public.site_traffic_daily where website_id = p_website_id),
    'last_day', (select max(day) from public.site_traffic_daily where website_id = p_website_id),
    'totals', (select jsonb_build_object(
        'views', coalesce(sum(views) filter (where day >= v_from), 0),
        'visitors', coalesce(sum(visitors) filter (where day >= v_from), 0),
        'previous_views', coalesce(sum(views) filter (where day < v_from), 0),
        'previous_visitors', coalesce(sum(visitors) filter (where day < v_from), 0))
      from public.site_traffic_daily
      where website_id = p_website_id and day >= v_prev),
    'series', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'views', views,
        'visitors', visitors) order by day)
      from public.site_traffic_daily where website_id = p_website_id and day >= v_from), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(x order by (x ->> 'views')::int desc) from (
        select jsonb_build_object('path', path, 'views', sum(views), 'visitors', sum(unique_visitors)) as x
        from public.site_pageviews_daily
        where website_id = p_website_id and day >= v_from
        group by path order by sum(views) desc limit 10) a), '[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(x order by (x ->> 'views')::int desc) from (
        select jsonb_build_object('host', referrer_host, 'views', sum(views)) as x
        from public.site_pageviews_daily
        where website_id = p_website_id and day >= v_from and referrer_host <> ''
        group by referrer_host order by sum(views) desc limit 10) b), '[]'::jsonb),
    'direct_views', (select coalesce(sum(views), 0) from public.site_pageviews_daily
        where website_id = p_website_id and day >= v_from and referrer_host = ''),
    'languages', coalesce((select jsonb_agg(x order by (x ->> 'views')::int desc) from (
        select jsonb_build_object('lang', lang, 'views', sum(views)) as x
        from public.site_pageviews_daily
        where website_id = p_website_id and day >= v_from
        group by lang order by sum(views) desc limit 8) c), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.site_analytics_summary(text, integer) from public, anon;
grant execute on function public.site_analytics_summary(text, integer) to authenticated;
