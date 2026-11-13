-- News, round 3: images from the official articles, "useful" votes and reads.
--   news_items.image_url        the article's own image (feed or og:image), https only
--   private.news_reactions      one "useful / not useful" per member and article
--   private.news_reads          a member opened the official article
--   portal_news_react / portal_news_read   member actions (portal key + session)
-- Counts are per website (a client's members), and never show who voted:
-- members are private clients preparing a move, so names stay private.

alter table private.news_items add column if not exists image_url text
  check (image_url is null or (image_url ~ '^https://[^[:space:]]+$' and char_length(image_url) <= 800));

create table if not exists private.news_reactions (
  item_id uuid not null references private.news_items (id) on delete cascade,
  customer_id uuid not null references public.portal_customers (id) on delete cascade,
  website_id text not null,
  helpful boolean not null,
  created_at timestamptz not null default now(),
  primary key (item_id, customer_id)
);
create index if not exists news_reactions_site_idx on private.news_reactions (website_id, item_id);

create table if not exists private.news_reads (
  item_id uuid not null references private.news_items (id) on delete cascade,
  customer_id uuid not null references public.portal_customers (id) on delete cascade,
  website_id text not null,
  created_at timestamptz not null default now(),
  primary key (item_id, customer_id)
);
create index if not exists news_reads_site_idx on private.news_reads (website_id, item_id);

revoke all on table private.news_reactions, private.news_reads from public, anon, authenticated;

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
  v_image text;
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
    v_image := v_item ->> 'image_url';
    if v_image is not null and (v_image !~ '^https://[^[:space:]]+$' or char_length(v_image) > 800) then
      v_image := null;
    end if;
    insert into private.news_items (source_id, country, url, title, published_at, summary_en, summary_fr, topics,
      important, relevant, image_url)
    values (s.id, s.country, v_item ->> 'url', v_item ->> 'title',
      case when coalesce(v_item ->> 'published_at', '') ~ '^\d{4}-\d{2}-\d{2}' then (v_item ->> 'published_at')::timestamptz end,
      left(nullif(v_item ->> 'summary_en', ''), 600), left(nullif(v_item ->> 'summary_fr', ''), 600),
      v_topics, coalesce(v_item ->> 'important', '') = 'true', coalesce(v_item ->> 'relevant', 'true') <> 'false', v_image)
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
    'updated_at', (select last_run_at from private.news_worker_state where id = 1),
    'covered', coalesce((select jsonb_agg(distinct s.country) from private.news_sources s where s.active), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(x order by x.at desc) from (
        select i.id, i.url, i.title, s.name as source, i.topics, i.important, i.image_url,
          coalesce(i.published_at, i.created_at) as at,
          case when v_lang = 'fr' then coalesce(i.summary_fr, i.summary_en) else coalesce(i.summary_en, i.summary_fr) end as summary,
          (select count(*) from private.news_reactions r where r.item_id = i.id and r.website_id = c.website_id and r.helpful) as helpful,
          (select count(*) from private.news_reads d where d.item_id = i.id and d.website_id = c.website_id) as reads,
          (select r.helpful from private.news_reactions r where r.item_id = i.id and r.customer_id = c.id) as mine
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

-- "Useful" (true), "not useful" (false) or withdrawn (null).
create or replace function public.portal_news_react(p_key text, p_session text, p_item uuid, p_helpful boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  if not exists (select 1 from private.news_items where id = p_item) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  perform private.hit_rate_limit('portal_news_react', c.id::text, 120, interval '1 hour');
  if p_helpful is null then
    delete from private.news_reactions where item_id = p_item and customer_id = c.id;
  else
    insert into private.news_reactions (item_id, customer_id, website_id, helpful)
    values (p_item, c.id, c.website_id, p_helpful)
    on conflict (item_id, customer_id) do update set helpful = excluded.helpful, created_at = now();
  end if;
  return jsonb_build_object('mine', p_helpful,
    'helpful', (select count(*) from private.news_reactions r where r.item_id = p_item and r.website_id = c.website_id and r.helpful));
end;
$$;

create or replace function public.portal_news_read(p_key text, p_session text, p_item uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  insert into private.news_reads (item_id, customer_id, website_id)
  select p_item, c.id, c.website_id where exists (select 1 from private.news_items where id = p_item)
  on conflict do nothing;
end;
$$;

revoke all on function public.portal_news_react(text, text, uuid, boolean), public.portal_news_read(text, text, uuid) from public;
grant execute on function public.portal_news_react(text, text, uuid, boolean), public.portal_news_read(text, text, uuid)
  to anon, authenticated;
