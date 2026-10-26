-- LevelUp own sources (project requests, LevelStudio insights). Always rolls
-- back; the exception message is the report and must show "0 failed".
DO $$
DECLARE
  u_adm uuid := gen_random_uuid(); u_view uuid := gen_random_uuid(); u_out uuid := gen_random_uuid();
  org_l uuid; org_x uuid; ws_l text; ws_s text; ws_x text; pr uuid;
  j jsonb; n int; r text[] := '{}';
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (u_adm, 'lu-adm@example.invalid', 'authenticated', 'authenticated'),
    (u_view, 'lu-view@example.invalid', 'authenticated', 'authenticated'),
    (u_out, 'lu-out@example.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.organizations (name, slug) VALUES ('LU test', 'lu-test-org') RETURNING id INTO org_l;
  INSERT INTO public.organizations (name, slug) VALUES ('Other test', 'lu-test-other') RETURNING id INTO org_x;
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
    (org_l, u_adm, 'admin'), (org_l, u_view, 'viewer'), (org_x, u_out, 'owner');
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_l, 'Showcase', 'active') RETURNING id INTO ws_l;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_l, 'Studio', 'active') RETURNING id INTO ws_s;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_x, 'Other', 'active') RETURNING id INTO ws_x;
  INSERT INTO public.website_features (website_id, organization_id, feature_key) VALUES
    (ws_l, org_l, 'project_requests'), (ws_s, org_l, 'studio_insights');
  INSERT INTO public.project_requests (name, email, business_name, project_type, ai_verdict, ai_score, ai_summary)
    VALUES ('Jane Founder', 'jane@startup.example', 'Startup Test', 'E-commerce', 'qualified', 82, 'Clear budget')
    RETURNING id INTO pr;

  -- viewer of the owning organization: read, masked, cannot edit
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_view, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.site_project_requests_list(ws_l, NULL, NULL, 'Startup Test');
  r := r || (CASE WHEN (j->>'total')::int = 1 AND j->'rows'->0->>'email' = 'j***@s***.example'
    AND j->'rows'->0->>'ai_verdict' = 'qualified' AND NOT (j->>'can_edit')::boolean
    AND j::text NOT LIKE '%jane@startup%' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' viewer reads requests, contact masked');
  BEGIN PERFORM public.site_update_project_request(ws_l, pr, 'contacted'); r := r || 'FAIL viewer updated a request'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS viewer cannot update'::text; END;
  BEGIN SELECT count(*) INTO n FROM public.project_requests; r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' table still closed to members (RLS)');
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS table still closed to members'::text; END;
  BEGIN PERFORM public.site_project_requests_list(ws_s); r := r || 'FAIL website without the feature listed requests'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS feature required'::text; END;
  j := public.site_studio_summary(ws_s, 30);
  r := r || (CASE WHEN j IS NOT NULL AND j ? 'projects_total' AND j::text NOT LIKE '%@%' THEN 'PASS' ELSE 'FAIL ' || coalesce(j::text, 'null') END || ' studio aggregates for members, no person');
  r := r || (CASE WHEN (public.site_owned_source_counts(ws_l)->>'project_requests')::int >= 1 THEN 'PASS' ELSE 'FAIL' END || ' capability count for members');
  r := r || (CASE WHEN jsonb_array_length(public.site_owned_activity(ws_l)) >= 1 THEN 'PASS' ELSE 'FAIL' END || ' activity for members');
  EXECUTE 'RESET ROLE';

  -- admin of the owning organization: full contact, update + audit
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.site_project_requests_list(ws_l, NULL, 'qualified', 'jane');
  r := r || (CASE WHEN (j->>'total')::int = 1 AND j->'rows'->0->>'email' = 'jane@startup.example' AND (j->>'can_edit')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' admin searches by contact');
  PERFORM public.site_update_project_request(ws_l, pr, 'contacted', 'Called on Monday');
  BEGIN PERFORM public.site_update_project_request(ws_l, pr, 'hacked'); r := r || 'FAIL invalid status accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS invalid status rejected'::text; END;
  BEGIN PERFORM public.site_update_project_request(ws_l, pr, NULL, '<script>alert(1)</script>'); r := r || 'FAIL HTML notes accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS HTML notes rejected'::text; END;
  j := public.site_project_requests_stats(ws_l, 30);
  r := r || (CASE WHEN (j->>'total')::int >= 1 AND (j->>'qualified')::int >= 1 THEN 'PASS' ELSE 'FAIL ' || coalesce(j::text, 'null') END || ' stats for the overview');
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN (SELECT status = 'contacted' AND notes = 'Called on Monday' AND reviewed_by = u_adm FROM public.project_requests WHERE id = pr) THEN 'PASS' ELSE 'FAIL' END || ' status, notes and reviewer saved');
  SELECT count(*) INTO n FROM public.site_audit_log WHERE website_id = ws_l AND action = 'project_request.updated';
  r := r || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL ' || n END || ' update audited');

  -- member of another organization: nothing
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.site_project_requests_list(ws_l); r := r || 'FAIL outsider listed requests'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS outsider cannot list requests'::text; END;
  BEGIN PERFORM public.site_project_requests_list(ws_x); r := r || 'FAIL own site without feature listed requests'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS own website without the feature: nothing'::text; END;
  r := r || (CASE WHEN public.site_project_requests_stats(ws_l) IS NULL AND public.site_studio_summary(ws_s) IS NULL
    AND (public.site_owned_source_counts(ws_l)->>'project_requests')::int = 0
    AND public.site_owned_activity(ws_l) = '[]'::jsonb THEN 'PASS' ELSE 'FAIL' END || ' outsider: no stats, counts or activity');
  BEGIN PERFORM public.site_update_project_request(ws_l, pr, 'won'); r := r || 'FAIL outsider updated'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS outsider cannot update'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM public.site_project_requests_list(ws_l); r := r || 'FAIL anon listed'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS anon cannot call'::text; END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION E'LEVELUP SOURCES TESTS (rolled back): % failed\n%',
    (SELECT count(*) FROM unnest(r) x WHERE x LIKE 'FAIL%'), array_to_string(r, E'\n');
END $$;
