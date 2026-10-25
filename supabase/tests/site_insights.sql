-- Adaptive dashboard reads (capabilities, overview, activity, generic forms
-- inbox) and custom form types. Always rolls back; the exception message is
-- the report and must show "0 failed".
DO $$
DECLARE
  u_a uuid := gen_random_uuid(); u_v uuid := gen_random_uuid(); u_b uuid := gen_random_uuid();
  org_a uuid; org_b uuid; ws_a text; ws_b text;
  j jsonb; n int; sid uuid; r text[] := '{}';
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (u_a, 'in-a@example.invalid', 'authenticated', 'authenticated'),
    (u_v, 'in-v@example.invalid', 'authenticated', 'authenticated'),
    (u_b, 'in-b@example.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.organizations (name, slug) VALUES ('In A', 'in-test-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('In B', 'in-test-b') RETURNING id INTO org_b;
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
    (org_a, u_a, 'editor'), (org_a, u_v, 'viewer'), (org_b, u_b, 'owner');
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'Site A', 'active') RETURNING id INTO ws_a;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_b, 'Site B', 'active') RETURNING id INTO ws_b;
  INSERT INTO public.website_features (website_id, organization_id, feature_key) VALUES
    (ws_a, org_a, 'contact_form'), (ws_a, org_a, 'newsletter');
  INSERT INTO public.services (website_id, organization_id, slug, name, status) VALUES (ws_a, org_a, 'cut', 'Cut', 'published');

  -- ---------- custom form types (anon, server call without origin) ----------
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM set_config('request.headers', '{}', true);
  BEGIN
    PERFORM public.submit_form(ws_a, 'volunteer_signup', 'Ana', 'ana@example.com', NULL, NULL, 'I can help',
      '{"shift":"morning","tshirt":"M"}'::jsonb);
    r := r || 'PASS custom form type accepted'::text;
  EXCEPTION WHEN others THEN r := r || ('FAIL custom form type: ' || SQLERRM); END;
  PERFORM public.submit_form(ws_a, 'newsletter', NULL, 'news@example.com');
  BEGIN PERFORM public.submit_form(ws_a, 'Bad Type!', 'X', 'x@example.com'); r := r || 'FAIL malformed form type accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS malformed form type rejected'::text; END;
  BEGIN PERFORM public.submit_form(ws_a, 'quote', 'X', 'x2@example.com'); r := r || 'FAIL quote without feature accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN r := r || 'PASS known type still needs its feature'::text; END;
  BEGIN PERFORM public.submit_form(ws_b, 'volunteer_signup', 'X', 'x3@example.com'); r := r || 'FAIL custom form without contact_form accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN r := r || 'PASS custom form needs contact_form'::text; END;
  EXECUTE 'RESET ROLE';

  -- ---------- member reads ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.site_capabilities(ws_a);
  r := r || (CASE WHEN (j->'counts'->>'submissions')::int = 2 AND (j->'counts'->>'services')::int = 1
    AND j->'features' = '["contact_form", "newsletter"]'::jsonb
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'forms') f WHERE f->>'form_type' = 'volunteer_signup' AND (f->>'new')::int = 1)
    AND j->>'last_content_update' IS NOT NULL THEN 'PASS' ELSE 'FAIL ' || j::text END || ' capabilities: features, counts, detected forms');
  j := public.site_submissions_list(ws_a, NULL, NULL, 'morning');
  r := r || (CASE WHEN (j->>'total')::int = 1 AND j->'rows'->0->'data'->>'shift' = 'morning' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' inbox search finds a value inside data');
  sid := (j->'rows'->0->>'id')::uuid;
  j := public.site_submissions_list(ws_a, 'newsletter');
  r := r || (CASE WHEN (j->>'total')::int = 1 THEN 'PASS' ELSE 'FAIL ' || j::text END || ' inbox filter by form type');
  j := public.site_submissions_list(ws_a, NULL, NULL, '%');
  r := r || (CASE WHEN (j->>'total')::int = 0 THEN 'PASS' ELSE 'FAIL ' || j::text END || ' search wildcards are escaped');
  UPDATE public.form_submissions SET status = 'archived' WHERE id = sid;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' viewer cannot change a status');
  j := public.site_overview_stats(ws_a, 30);
  r := r || (CASE WHEN (j->'newsletter'->>'total')::int = 1 AND (j->'submissions'->>'new')::int = 2
    AND jsonb_array_length(j->'submissions'->'by_type') = 2 AND j ? 'payments' AND j ? 'traffic' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' overview stats');
  j := public.site_recent_activity(ws_a, 10);
  r := r || (CASE WHEN jsonb_array_length(j) = 2 AND j->0->>'kind' = 'submission' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' recent activity');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.form_submissions SET status = 'archived' WHERE id = sid;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' editor archives a submission');
  j := public.site_submissions_list(ws_a, NULL, ARRAY['new']);
  r := r || (CASE WHEN (j->>'total')::int = 1 THEN 'PASS' ELSE 'FAIL ' || j::text END || ' archived leaves the new filter');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.site_capabilities(ws_a);
  r := r || (CASE WHEN j IS NULL THEN 'PASS' ELSE 'FAIL ' || j::text END || ' other organization: no capabilities (RLS)');
  j := public.site_submissions_list(ws_a);
  r := r || (CASE WHEN (j->>'total')::int = 0 THEN 'PASS' ELSE 'FAIL' END || ' other organization: empty inbox');
  j := public.site_recent_activity(ws_a);
  r := r || (CASE WHEN j = '[]'::jsonb THEN 'PASS' ELSE 'FAIL' END || ' other organization: no activity');
  j := public.site_overview_stats(ws_a, 7);
  r := r || (CASE WHEN (j->'submissions'->>'new')::int = 0 THEN 'PASS' ELSE 'FAIL' END || ' other organization: zero stats');
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION E'SITE INSIGHTS TESTS (rolled back): % failed\n%',
    (SELECT count(*) FROM unnest(r) x WHERE x LIKE 'FAIL%'), array_to_string(r, E'\n');
END $$;
