-- Showcase CMS (showcase_templates / showcase_projects / showcase_sections):
-- RLS, checks and the get_site_bundle "showcase" key. Always rolls back; the
-- exception message is the report. Avoids DELETE statements on purpose.
SET LOCAL statement_timeout = '20s';
DO $$
DECLARE
  u_a uuid := gen_random_uuid(); u_b uuid := gen_random_uuid(); u_v uuid := gen_random_uuid();
  org_a uuid; org_b uuid; ws_a text; ws_b text; n integer; j jsonb;
  results text[] := '{}';
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (u_a,'a@t.l','authenticated','authenticated'), (u_b,'b@t.l','authenticated','authenticated'),
    (u_v,'v@t.l','authenticated','authenticated');
  INSERT INTO public.organizations (name, slug) VALUES ('Org A','sc-org-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('Org B','sc-org-b') RETURNING id INTO org_b;
  INSERT INTO public.organization_members VALUES (org_a, u_a, 'editor'), (org_b, u_b, 'owner'), (org_a, u_v, 'viewer');
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'Site A', 'active') RETURNING id INTO ws_a;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_b, 'Site B', 'active') RETURNING id INTO ws_b;
  INSERT INTO public.website_features (website_id, organization_id, feature_key) VALUES (ws_a, org_a, 'showcase_cms');

  INSERT INTO public.showcase_templates (website_id, organization_id, slug, name, url, desktop_image, status, sort_order)
  VALUES (ws_a, org_a, 'pub', 'Published', 'https://a.example/', 'https://a.example/d.webp', 'published', 20),
         (ws_a, org_a, 'first', 'First', 'https://a.example/', 'https://a.example/d.webp', 'published', 10),
         (ws_a, org_a, 'draft', 'Draft', 'https://a.example/', NULL, 'draft', 0),
         (ws_a, org_a, 'hid', 'Hidden', 'https://a.example/', NULL, 'hidden', 0),
         (ws_b, org_b, 'b-pub', 'B published', 'https://b.example/', NULL, 'published', 0);
  INSERT INTO public.showcase_projects (website_id, organization_id, slug, name, url, status)
  VALUES (ws_a, org_a, 'case', 'Case', 'https://c.example', 'published'),
         (ws_a, org_a, 'wip', 'WIP', '/projects/wip', 'draft'),
         (ws_b, org_b, 'b-case', 'B case', 'https://d.example', 'published');
  INSERT INTO public.showcase_sections (website_id, organization_id, page, section_key, enabled, sort_order)
  VALUES (ws_a, org_a, 'home', 'templates', false, 10), (ws_a, org_a, 'home', 'work', true, 20);

  -- Checks
  BEGIN INSERT INTO public.showcase_templates (website_id, organization_id, slug, name, url, layout) VALUES (ws_a, org_a, 'x', 'X', 'https://x.example/', 'carousel');
    results := results || 'FAIL unknown layout accepted'::text;
  EXCEPTION WHEN check_violation THEN results := results || 'PASS layout limited to the five layouts'::text; END;
  BEGIN INSERT INTO public.showcase_templates (website_id, organization_id, slug, name, url, animation) VALUES (ws_a, org_a, 'x', 'X', 'https://x.example/', 'spin');
    results := results || 'FAIL unknown animation accepted'::text;
  EXCEPTION WHEN check_violation THEN results := results || 'PASS animation limited to the five presets'::text; END;
  BEGIN INSERT INTO public.showcase_templates (website_id, organization_id, slug, name, url) VALUES (ws_a, org_a, 'x', 'X', 'javascript:alert(1)');
    results := results || 'FAIL non-https template url accepted'::text;
  EXCEPTION WHEN check_violation THEN results := results || 'PASS template url must be https'::text; END;
  BEGIN INSERT INTO public.showcase_projects (website_id, organization_id, slug, name, url) VALUES (ws_a, org_a, 'Bad Slug', 'X', '/x');
    results := results || 'FAIL bad slug accepted'::text;
  EXCEPTION WHEN check_violation THEN results := results || 'PASS slug is a route segment'::text; END;
  BEGIN INSERT INTO public.showcase_sections (website_id, organization_id, page, section_key) VALUES (ws_a, org_a, 'admin', 'x');
    results := results || 'FAIL unknown page accepted'::text;
  EXCEPTION WHEN check_violation THEN results := results || 'PASS section page limited to the site pages'::text; END;
  BEGIN INSERT INTO public.showcase_sections (website_id, organization_id, page, section_key) VALUES (ws_a, org_a, 'home', 'work');
    results := results || 'FAIL duplicate section accepted'::text;
  EXCEPTION WHEN unique_violation THEN results := results || 'PASS one row per page section'::text; END;

  -- Anonymous visitors
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO n FROM public.showcase_templates WHERE website_id = ws_a;
  results := results || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL' END || ' anon sees only published templates (' || n || ')');
  SELECT count(*) INTO n FROM public.showcase_projects WHERE website_id = ws_a;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' anon sees only published projects');
  BEGIN INSERT INTO public.showcase_templates (website_id, organization_id, slug, name, url) VALUES (ws_a, org_a, 'anon', 'A', 'https://x.example/');
    results := results || 'FAIL anon insert'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS anon cannot write templates'::text; END;
  BEGIN
    UPDATE public.showcase_sections SET enabled = true WHERE website_id = ws_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' anon cannot toggle sections');
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS anon cannot toggle sections'::text; END;
  j := public.get_site_bundle(ws_a) -> 'showcase';
  results := results || (CASE WHEN jsonb_array_length(j -> 'templates') = 2
      AND j -> 'templates' -> 0 ->> 'slug' = 'first' THEN 'PASS' ELSE 'FAIL' END || ' bundle: published templates in sort order');
  results := results || (CASE WHEN NOT (j -> 'templates' -> 0) ? 'organization_id' AND NOT (j -> 'templates' -> 0) ? 'id'
      THEN 'PASS' ELSE 'FAIL' END || ' bundle: no internal columns');
  results := results || (CASE WHEN jsonb_array_length(j -> 'projects') = 1 THEN 'PASS' ELSE 'FAIL' END || ' bundle: drafts left out');
  results := results || (CASE WHEN jsonb_array_length(j -> 'sections') = 2
      AND (j -> 'sections' -> 0 ->> 'enabled')::boolean = false THEN 'PASS' ELSE 'FAIL' END || ' bundle: disabled sections included (on/off)');
  results := results || (CASE WHEN public.get_site_bundle(ws_b) -> 'showcase' = 'null'::jsonb
      OR public.get_site_bundle(ws_b) -> 'showcase' IS NULL THEN 'PASS' ELSE 'FAIL' END || ' bundle: no showcase without the feature');
  EXECUTE 'RESET ROLE';

  -- Another organization
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.showcase_templates WHERE website_id = ws_a AND status <> 'published';
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' org B cannot see org A drafts');
  UPDATE public.showcase_templates SET name = 'hacked' WHERE website_id = ws_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' org B cannot edit org A templates');
  UPDATE public.showcase_projects SET status = 'hidden' WHERE website_id = ws_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' org B cannot hide org A projects');
  BEGIN INSERT INTO public.showcase_sections (website_id, organization_id, page, section_key) VALUES (ws_a, org_a, 'faq', 'faq');
    results := results || 'FAIL org B inserted into org A'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS org B cannot add org A sections'::text; END;
  EXECUTE 'RESET ROLE';

  -- Viewer of org A: reads drafts, cannot write
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.showcase_templates WHERE website_id = ws_a;
  results := results || (CASE WHEN n = 4 THEN 'PASS' ELSE 'FAIL' END || ' viewer reads every template of the org');
  UPDATE public.showcase_templates SET layout = 'card' WHERE website_id = ws_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' viewer cannot edit');
  EXECUTE 'RESET ROLE';

  -- Editor of org A: full content control
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.showcase_templates SET layout = 'split-right', animation = 'clip', status = 'hidden' WHERE website_id = ws_a AND slug = 'pub';
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' editor changes layout, animation and hides a template');
  UPDATE public.showcase_sections SET enabled = true, title_en = E'New\nTitle' WHERE website_id = ws_a AND section_key = 'templates';
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' editor toggles a section and edits its text');
  INSERT INTO public.showcase_projects (website_id, organization_id, slug, name, url, status)
  VALUES (ws_a, org_a, 'new-case', 'New case', 'https://e.example', 'published');
  results := results || 'PASS editor adds a project'::text;
  j := public.get_site_bundle(ws_a) -> 'showcase';
  results := results || (CASE WHEN jsonb_array_length(j -> 'templates') = 1 AND jsonb_array_length(j -> 'projects') = 2
      THEN 'PASS' ELSE 'FAIL' END || ' bundle follows the edits');
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION E'SHOWCASE CMS TESTS (rolled back): % failed\n%', (SELECT count(*) FROM unnest(results) r WHERE r LIKE 'FAIL%'), array_to_string(results, E'\n');
END;
$$;
