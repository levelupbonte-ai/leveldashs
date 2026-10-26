-- Visitor analytics (track_pageview + site_analytics_summary). Always rolls
-- back; the exception message is the report and must show "0 failed".
DO $$
DECLARE
  u_a uuid := gen_random_uuid(); u_b uuid := gen_random_uuid();
  org_a uuid; org_b uuid; ws_a text; ws_b text;
  ok boolean; n int; j jsonb; r text[] := '{}';
  h_good text := '{"origin":"https://shop-a.example","user-agent":"Mozilla/5.0 (Macintosh) Safari/605","x-forwarded-for":"203.0.113.7, 10.0.0.1"}';
BEGIN
  -- ---------- pure helpers ----------
  r := r || (CASE WHEN private.normalize_path('/Blog/Post-1/?utm_source=x#top') = '/blog/post-1' THEN 'PASS' ELSE 'FAIL ' || private.normalize_path('/Blog/Post-1/?utm_source=x#top') END || ' path: query, hash, case, trailing slash');
  r := r || (CASE WHEN private.normalize_path('https://shop-a.example//orders/123456789/') = '/orders/:id' THEN 'PASS' ELSE 'FAIL ' || private.normalize_path('https://shop-a.example//orders/123456789/') END || ' path: absolute URL, double slash, long number');
  r := r || (CASE WHEN private.normalize_path('/u/jane@example.com/reset/3f2a9c1e5b7d4f60a1b2c3d4') = '/u/:id/reset/:id' THEN 'PASS' ELSE 'FAIL ' || private.normalize_path('/u/jane@example.com/reset/3f2a9c1e5b7d4f60a1b2c3d4') END || ' path: e-mail and token segments removed');
  r := r || (CASE WHEN private.normalize_path(NULL) = '/' AND private.normalize_path('<script>') = '/script' THEN 'PASS' ELSE 'FAIL' END || ' path: empty and markup');
  r := r || (CASE WHEN char_length(private.normalize_path('/' || repeat('a', 5000))) <= 200 THEN 'PASS' ELSE 'FAIL' END || ' path: capped');
  r := r || (CASE WHEN private.referrer_host('https://www.Google.com/search?q=1') = 'google.com' AND private.referrer_host('javascript:alert(1)') = ''
    AND private.referrer_host('https://user:pw@evil.example/') = '' THEN 'PASS' ELSE 'FAIL' END || ' referrer host only, invalid dropped');
  r := r || (CASE WHEN private.primary_lang('fr-CA') = 'fr' AND private.primary_lang('en') = 'en' AND private.primary_lang('12') = '' THEN 'PASS' ELSE 'FAIL' END || ' language primary subtag');

  -- ---------- fixtures ----------
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (u_a, 'an-a@example.invalid', 'authenticated', 'authenticated'),
    (u_b, 'an-b@example.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.organizations (name, slug) VALUES ('An A', 'an-test-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('An B', 'an-test-b') RETURNING id INTO org_b;
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org_a, u_a, 'viewer'), (org_b, u_b, 'owner');
  INSERT INTO public.websites (organization_id, name, status, allowed_origins)
    VALUES (org_a, 'Shop A', 'active', ARRAY['https://shop-a.example']) RETURNING id INTO ws_a;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_b, 'Shop B', 'active') RETURNING id INTO ws_b;

  -- ---------- tracking as anon ----------
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM set_config('request.headers', '{"user-agent":"Mozilla/5.0"}', true);
  r := r || (CASE WHEN NOT public.track_pageview(ws_a, '/') THEN 'PASS' ELSE 'FAIL' END || ' no origin -> not counted');
  PERFORM set_config('request.headers', '{"origin":"https://evil.example","user-agent":"Mozilla/5.0"}', true);
  r := r || (CASE WHEN NOT public.track_pageview(ws_a, '/') THEN 'PASS' ELSE 'FAIL' END || ' foreign origin -> not counted');
  PERFORM set_config('request.headers', '{"origin":"https://shop-a.example","user-agent":"Googlebot/2.1"}', true);
  r := r || (CASE WHEN NOT public.track_pageview(ws_a, '/') THEN 'PASS' ELSE 'FAIL' END || ' bot -> not counted');
  r := r || (CASE WHEN NOT public.track_pageview('ws_notasite00', '/') THEN 'PASS' ELSE 'FAIL' END || ' unknown website -> not counted');
  r := r || (CASE WHEN NOT public.track_pageview(ws_b, '/') THEN 'PASS' ELSE 'FAIL' END || ' website without allowed origins -> not counted');

  PERFORM set_config('request.headers', h_good, true);
  ok := public.track_pageview(ws_a, '/Pricing?ref=ad', 'https://www.google.com/search?q=shop', 'fr-CA');
  r := r || (CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' allowed origin -> counted');
  PERFORM public.track_pageview(ws_a, '/pricing', 'https://shop-a.example/', 'fr-CA');
  PERFORM public.track_pageview(ws_a, '/about', NULL, 'fr');
  PERFORM set_config('request.headers', replace(h_good, '203.0.113.7', '198.51.100.9'), true);
  PERFORM public.track_pageview(ws_a, '/pricing', NULL, 'en-US');
  -- through the tag proxy: same proxy address, the visitor comes in x-lu-client-*
  PERFORM set_config('request.headers', '{"origin":"https://shop-a.example","user-agent":"node","x-forwarded-for":"10.9.9.9","x-lu-client-ip":"203.0.113.7","x-lu-client-ua":"Mozilla/5.0 (Macintosh) Safari/605"}', true);
  PERFORM public.track_pageview(ws_a, '/contact');
  BEGIN SELECT count(*) INTO n FROM public.site_traffic_daily; r := r || 'FAIL anon reads traffic'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS anon cannot read traffic'::text; END;

  -- rate limit: one bucket accepts 60 views per 5 minutes
  PERFORM set_config('request.headers', replace(h_good, '203.0.113.7', '192.0.2.44'), true);
  n := 0;
  FOR i IN 1..65 LOOP
    IF public.track_pageview(ws_a, '/spam') THEN n := n + 1; END IF;
  END LOOP;
  r := r || (CASE WHEN n = 60 THEN 'PASS' ELSE 'FAIL ' || n END || ' rate limit: 60 views per bucket');
  EXECUTE 'RESET ROLE';

  r := r || (CASE WHEN (SELECT views FROM public.site_traffic_daily WHERE website_id = ws_a) = 65
    AND (SELECT visitors FROM public.site_traffic_daily WHERE website_id = ws_a) = 3 THEN 'PASS'
    ELSE 'FAIL ' || (SELECT views || '/' || visitors FROM public.site_traffic_daily WHERE website_id = ws_a) END || ' 65 views, 3 unique visitors (proxy headers identify the same visitor)');
  r := r || (CASE WHEN (SELECT sum(views) FROM public.site_pageviews_daily WHERE website_id = ws_a AND path = '/pricing') = 3
    AND (SELECT sum(unique_visitors) FROM public.site_pageviews_daily WHERE website_id = ws_a AND path = '/pricing') = 2 THEN 'PASS' ELSE 'FAIL' END || ' /pricing: 3 views, 2 visitors');
  r := r || (CASE WHEN EXISTS (SELECT 1 FROM public.site_pageviews_daily WHERE website_id = ws_a AND referrer_host = 'google.com' AND lang = 'fr')
    AND NOT EXISTS (SELECT 1 FROM public.site_pageviews_daily WHERE website_id = ws_a AND referrer_host = 'shop-a.example') THEN 'PASS' ELSE 'FAIL' END || ' external referrer kept, self referral dropped');
  r := r || (CASE WHEN NOT EXISTS (SELECT 1 FROM public.site_pageviews_daily p WHERE p::text LIKE '%203.0.113%' OR p::text ILIKE '%mozilla%')
    AND NOT EXISTS (SELECT 1 FROM private.pageview_buckets b WHERE b::text LIKE '%203.0.113%')
    AND NOT EXISTS (SELECT 1 FROM private.site_visitor_bloom b WHERE b.website_id = ws_a AND encode(b.bits, 'escape') LIKE '%203.0.113%') THEN 'PASS' ELSE 'FAIL' END || ' no IP or user agent stored');

  -- ---------- reads ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.site_analytics_summary(ws_a, 7);
  r := r || (CASE WHEN (j->'totals'->>'views')::int = 65 AND (j->'totals'->>'visitors')::int = 3 AND j->'pages'->0->>'path' = '/spam'
    AND j->'referrers'->0->>'host' = 'google.com' AND (j->>'has_data')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' viewer reads the summary');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.site_analytics_summary(ws_a, 7);
  r := r || (CASE WHEN (j->'totals'->>'views')::int = 0 AND NOT (j->>'has_data')::boolean AND j->'pages' = '[]'::jsonb THEN 'PASS' ELSE 'FAIL ' || j::text END || ' other organization sees nothing (RLS)');
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION E'SITE ANALYTICS TESTS (rolled back): % failed\n%',
    (SELECT count(*) FROM unnest(r) x WHERE x LIKE 'FAIL%'), array_to_string(r, E'\n');
END $$;
