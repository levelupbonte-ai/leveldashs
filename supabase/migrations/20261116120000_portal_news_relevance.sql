-- News, round 2 after the first real run:
--   - relevance: the AI marks whether an article matters to someone preparing
--     to visit, study, work or settle in the country; members only see those
--     (irrelevant ones stay stored so they are never summarized twice);
--   - pairs: one source published in two languages (Canada EN/FR) shows only
--     the member's language;
--   - sources: US travel advisories (written for Americans going abroad) off;
--     more official candidates for France and Belgium (each run records whether
--     a feed answers);
--   - the first run's articles are cleared (cached public data) so they are
--     summarized again with the relevance check.

alter table private.news_items add column if not exists relevant boolean not null default true;
alter table private.news_sources add column if not exists pair text check (pair ~ '^[a-z0-9-]{2,40}$');

update private.news_sources set pair = 'ca-ircc' where id in ('ca-ircc-en', 'ca-ircc-fr');
update private.news_sources set active = false where id = 'us-travel';

insert into private.news_sources (id, country, name, feed_url, home_url, lang) values
  ('fr-diplomatie', 'FR', 'France Diplomatie — Ministère de l’Europe et des Affaires étrangères',
   'https://www.diplomatie.gouv.fr/spip.php?page=backend', 'https://www.diplomatie.gouv.fr/fr/', 'fr'),
  ('fr-immigration', 'FR', 'Ministère de l’Intérieur — Immigration',
   'https://www.immigration.interieur.gouv.fr/rss.xml', 'https://www.immigration.interieur.gouv.fr/', 'fr'),
  ('be-dofi', 'BE', 'Office des Étrangers (Belgique)',
   'https://dofi.ibz.be/fr/rss.xml', 'https://dofi.ibz.be/fr', 'fr'),
  ('be-study', 'BE', 'Study in Belgium',
   'https://www.studyinbelgium.be/fr/rss.xml', 'https://www.studyinbelgium.be/fr', 'fr')
on conflict (id) do nothing;

delete from private.news_items;
update private.news_worker_state set last_run_at = null where id = 1;

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
    insert into private.news_items (source_id, country, url, title, published_at, summary_en, summary_fr, topics, important, relevant)
    values (s.id, s.country, v_item ->> 'url', v_item ->> 'title',
      case when coalesce(v_item ->> 'published_at', '') ~ '^\d{4}-\d{2}-\d{2}' then (v_item ->> 'published_at')::timestamptz end,
      left(nullif(v_item ->> 'summary_en', ''), 600), left(nullif(v_item ->> 'summary_fr', ''), 600),
      v_topics, coalesce(v_item ->> 'important', '') = 'true', coalesce(v_item ->> 'relevant', 'true') <> 'false')
    on conflict (url) do nothing;
    if found then
      v_added := v_added + 1;
    end if;
  end loop;
  update private.news_sources set last_fetched_at = now(), last_status = left(coalesce(p_status, 'ok'), 80),
    last_count = v_added where id = s.id;
  delete from private.news_items where created_at < now() - interval '180 days';
  return jsonb_build_object('added', v_added);
end;
$$;

-- A source the member sees: active, and for a pair, the one in their language.
create or replace function private.news_source_visible(s private.news_sources, p_lang text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select s.active and (s.pair is null or s.lang = p_lang or not exists (
    select 1 from private.news_sources o where o.pair = s.pair and o.active and o.lang = p_lang));
$$;

create or replace function public.portal_news(p_key text, p_session text, p_country text default null, p_lang text default 'fr')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
  v_country text;
  v_lang text := case when coalesce(p_lang, 'fr') = 'en' then 'en' else 'fr' end;
  v_full boolean;
  v_limit integer;
begin
  c := private.portal_session(p_key, p_session);
  v_country := upper(coalesce(nullif(p_country, ''), c.profile ->> 'destinationCountry', ''));
  if v_country !~ '^[A-Z]{2}$' then
    v_country := null;
  end if;
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
          case when v_lang = 'fr' then coalesce(i.summary_fr, i.summary_en) else coalesce(i.summary_en, i.summary_fr) end as summary
        from private.news_items i join private.news_sources s on s.id = i.source_id
        where i.country = v_country and i.relevant and private.news_source_visible(s, v_lang)
          and coalesce(i.published_at, i.created_at) > now() - interval '120 days'
        order by coalesce(i.published_at, i.created_at) desc limit v_limit) x), '[]'::jsonb),
    'total', (select count(*) from private.news_items i join private.news_sources s on s.id = i.source_id
        where i.country = v_country and i.relevant and private.news_source_visible(s, v_lang)
          and coalesce(i.published_at, i.created_at) > now() - interval '120 days'),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'url', s.home_url))
        from private.news_sources s where s.country = v_country and private.news_source_visible(s, v_lang)
          and coalesce(s.last_status, 'ok') = 'ok'), '[]'::jsonb),
    'guide', (select g.links from private.news_guides g where g.country = v_country
        and g.updated_at > now() - interval '30 days'));
end;
$$;

revoke all on function private.news_source_visible(private.news_sources, text) from public, anon, authenticated;
