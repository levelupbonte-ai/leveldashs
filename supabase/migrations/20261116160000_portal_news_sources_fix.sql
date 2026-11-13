-- News sources after the second real run:
--   - Canada: the French feed only (members get the summary in their language
--     anyway); two copies of each article made the AI judge them twice.
--   - Sources that refuse automated readers (403) or do not exist (404) are
--     turned off: their refusal is respected, never worked around.
--   - A country counts as "covered" only when one of its sources works; the
--     others (France for now) show their official websites instead.
--   - Canada and US articles are summarized again with the steadier rule.

update private.news_sources set active = false
where id in ('ca-ircc-en', 'fr-diplomatie', 'fr-immigration', 'fr-service-public', 'be-study');

delete from private.news_items where source_id in ('ca-ircc-en', 'ca-ircc-fr', 'us-uscis');
update private.news_worker_state set last_run_at = null where id = 1;

create or replace function private.news_covered()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(distinct s.country), '[]'::jsonb)
  from private.news_sources s
  where s.active and (s.last_status is null or s.last_status in ('ok', 'empty', 'ai_failed'));
$$;
revoke all on function private.news_covered() from public, anon, authenticated;

do $$
declare
  v_def text := pg_get_functiondef('public.portal_news(text, text, text, text)'::regprocedure);
  v_new text;
begin
  v_new := replace(v_def,
    $old$'covered', coalesce((select jsonb_agg(distinct s.country) from private.news_sources s where s.active), '[]'::jsonb),$old$,
    $new$'covered', private.news_covered(),$new$);
  if v_new = v_def then
    raise exception 'portal_news: pattern not found';
  end if;
  execute v_new;
end;
$$;
