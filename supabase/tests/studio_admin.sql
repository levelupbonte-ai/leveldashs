-- LevelStudio in the staff area (migration studio_admin): only platform admins on aal2
-- list templates and sites, preview them, reveal a creator e-mail and publish; every
-- call is audited; clients (including LevelUp's own non-staff members), studio users and
-- anon get nothing; a studio user still sees only their own projects.
-- Always rolls back; the exception message is the report and must show `0 failed`.
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE
  u_p uuid := gen_random_uuid();   -- LevelUp staff (platform admin)
  u_m uuid := gen_random_uuid();   -- member (admin) of the LevelUp organization, not staff
  u_o uuid := gen_random_uuid();   -- owner of another client organization
  u_s1 uuid := gen_random_uuid();  -- LevelStudio user 1
  u_s2 uuid := gen_random_uuid();  -- LevelStudio user 2
  levelup uuid := '716c151f-1c1f-4ba6-a02c-53ab6a9aa169';
  org_x uuid;
  p1 uuid; p2 uuid;
  staff2 text; staff1 text;
  j jsonb; n integer; audit_before integer;
  results text[] := '{}';
  failed integer;
  fn text;
  calls text[] := ARRAY[
    'select public.admin_studio_templates()',
    'select public.admin_studio_projects(null, null, 1, 20)',
    'select public.admin_studio_template_preview(''zz-studio-tpl'')',
    'select public.admin_studio_project_preview(''%p1%'')',
    'select public.admin_studio_creator_email(''%p1%'')',
    'select public.admin_studio_set_template_published(''zz-studio-tpl'', false)'];
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (u_p, 'staff@zz-studio.test', 'authenticated', 'authenticated'),
    (u_m, 'member@zz-studio.test', 'authenticated', 'authenticated'),
    (u_o, 'owner@zz-studio.test', 'authenticated', 'authenticated'),
    (u_s1, 'maker.one@zz-studio.test', 'authenticated', 'authenticated'),
    (u_s2, 'maker.two@zz-studio.test', 'authenticated', 'authenticated');
  INSERT INTO public.platform_admins (user_id) VALUES (u_p);
  INSERT INTO public.organization_members VALUES (levelup, u_m, 'admin');
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Studio X', 'zz-studio-x') RETURNING id INTO org_x;
  INSERT INTO public.organization_members VALUES (org_x, u_o, 'owner');
  INSERT INTO public.studio_templates (id, name, kind, service, html, is_published, sort_order)
  VALUES ('zz-studio-tpl', 'Zz Studio Template', 'starter', 'landing', '<html><body>tpl</body></html>', true, 999);
  INSERT INTO public.studio_templates (id, name, kind, service, owner_user_id, is_published)
  VALUES ('zz-studio-import', 'Zz Import', 'import', 'landing', u_s1, false);
  INSERT INTO public.studio_projects (user_id, title, html, template_id, share_token, messages)
  VALUES (u_s1, 'Zz Bakery', '<html><body>v2</body></html>', 'zz-studio-tpl', md5('zz-share'),
    '[{"role":"user","kind":"text"},{"role":"assistant","kind":"site","html":"<html>v1</html>"},{"role":"assistant","kind":"site","html":"<html>v2</html>"}]')
  RETURNING id INTO p1;
  INSERT INTO public.studio_projects (user_id, title, html) VALUES (u_s2, 'Zz Garage', NULL) RETURNING id INTO p2;
  calls[4] := replace(calls[4], '%p1%', p1::text);
  calls[5] := replace(calls[5], '%p1%', p1::text);
  staff2 := json_build_object('sub', u_p, 'role', 'authenticated', 'email', 'staff@zz-studio.test', 'aal', 'aal2')::text;
  staff1 := json_build_object('sub', u_p, 'role', 'authenticated', 'email', 'staff@zz-studio.test', 'aal', 'aal1')::text;

  -- ================================================================ staff on aal2
  SELECT count(*) INTO audit_before FROM public.hq_audit_log WHERE actor_id = u_p;
  PERFORM set_config('request.jwt.claims', staff2, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.admin_studio_templates();
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(j) t WHERE t->>'id' = 'zz-studio-tpl'
        AND (t->>'is_published')::boolean AND (t->>'has_html')::boolean AND (t->>'uses')::int = 1)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(j) t WHERE t->>'id' = 'zz-studio-import'
        AND t->>'owner_email_masked' = 'm***@zz-studio.test')
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j) t WHERE t ? 'html')
    THEN 'PASS' ELSE 'FAIL' END || ' staff (aal2) list templates, imports included with a masked owner, no HTML in the list');
  j := public.admin_studio_projects('zz bakery', NULL, 1, 20);
  results := results || (CASE WHEN (j->>'total')::int = 1 AND j->'rows'->0->>'id' = p1::text
      AND (j->'rows'->0->>'versions')::int = 2 AND j->'rows'->0->>'status' = 'shared'
      AND j->'rows'->0->>'share_path' = '/p/' || md5('zz-share')
      AND j->'rows'->0->>'creator_email_masked' = 'm***@zz-studio.test'
      AND j->'rows'->0->>'template_name' = 'Zz Studio Template'
      AND NOT (j->'rows'->0 ? 'html') AND j::text NOT LIKE '%maker.one%'
    THEN 'PASS' ELSE 'FAIL ' || j::text END || ' staff search sites by title: versions, shared status and link, masked creator, no HTML');
  j := public.admin_studio_projects('maker.two@zz', NULL, 1, 20);
  results := results || (CASE WHEN (j->>'total')::int = 1 AND j->'rows'->0->>'id' = p2::text
      AND j->'rows'->0->>'status' = 'draft' AND j->'rows'->0->'share_path' = 'null'::jsonb
      AND (j->'rows'->0->>'versions')::int = 0
    THEN 'PASS' ELSE 'FAIL ' || j::text END || ' staff search by creator e-mail; a site without a link is a draft');
  j := public.admin_studio_projects('zz', 'shared', 1, 20);
  results := results || (CASE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'rows') r WHERE r->>'id' = p2::text)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'rows') r WHERE r->>'id' = p1::text)
    THEN 'PASS' ELSE 'FAIL' END || ' status filter (shared)');
  j := public.admin_studio_projects('100%_\', NULL, 1, 20);
  results := results || (CASE WHEN (j->>'total')::int = 0 THEN 'PASS' ELSE 'FAIL' END || ' LIKE wildcards in the search are literal');
  BEGIN PERFORM public.admin_studio_projects(NULL, 'deleted', 1, 20); results := results || 'FAIL unknown status accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS unknown status refused'::text; END;
  j := public.admin_studio_project_preview(p1);
  results := results || (CASE WHEN j->>'html' = '<html><body>v2</body></html>' THEN 'PASS' ELSE 'FAIL' END || ' staff preview the current version of a site');
  j := public.admin_studio_template_preview('zz-studio-tpl');
  results := results || (CASE WHEN j->>'html' = '<html><body>tpl</body></html>' THEN 'PASS' ELSE 'FAIL' END || ' staff preview a template');
  j := public.admin_studio_creator_email(p1);
  results := results || (CASE WHEN j->>'email' = 'maker.one@zz-studio.test' THEN 'PASS' ELSE 'FAIL' END || ' staff reveal the full creator e-mail on purpose');
  j := public.admin_studio_set_template_published('zz-studio-tpl', false);
  results := results || (CASE WHEN (j->>'is_published')::boolean = false THEN 'PASS' ELSE 'FAIL' END || ' staff unpublish a template');
  BEGIN PERFORM public.admin_studio_set_template_published('zz-studio-import', true); results := results || 'FAIL import published'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS an import cannot be published (private to its owner)'::text; END;
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN (SELECT count(*) FROM public.hq_audit_log WHERE actor_id = u_p AND action = 'studio.viewed') - 0 >= 7
      AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE actor_id = u_p AND action = 'studio.viewed' AND metadata->>'list' = 'templates')
      AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE actor_id = u_p AND action = 'studio.viewed' AND metadata->>'list' = 'projects'
        AND (metadata->>'searched')::boolean AND metadata::text NOT LIKE '%bakery%')
      AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE actor_id = u_p AND action = 'studio.viewed' AND target_type = 'studio_project' AND target_id = p1::text)
      AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE actor_id = u_p AND action = 'studio.creator_email_viewed' AND target_id = p1::text)
      AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE actor_id = u_p AND action = 'studio.template_unpublished' AND target_id = 'zz-studio-tpl')
    THEN 'PASS' ELSE 'FAIL' END || ' every list and preview is audited as studio.viewed (search text not logged); e-mail reveal and unpublish audited');

  -- LevelStudio's cold-start upsert (is_published = true) keeps the staff decision.
  INSERT INTO public.studio_templates (id, name, kind, service, is_published)
  VALUES ('zz-studio-tpl', 'Zz Studio Template', 'starter', 'landing', true)
  ON CONFLICT (id) DO UPDATE SET name = excluded.name, is_published = excluded.is_published;
  results := results || (CASE WHEN (SELECT is_published FROM public.studio_templates WHERE id = 'zz-studio-tpl') = false
    THEN 'PASS' ELSE 'FAIL' END || ' LevelStudio''s built-in template sync does not undo an unpublish');
  PERFORM set_config('request.jwt.claims', staff2, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.admin_studio_set_template_published('zz-studio-tpl', true);
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN (SELECT is_published FROM public.studio_templates WHERE id = 'zz-studio-tpl')
    THEN 'PASS' ELSE 'FAIL' END || ' staff publish it again');

  -- ================================================================ refused
  FOREACH fn IN ARRAY calls LOOP
    -- staff on aal1
    PERFORM set_config('request.jwt.claims', staff1, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN EXECUTE fn; results := results || ('FAIL staff aal1: ' || fn);
    EXCEPTION WHEN SQLSTATE 'PT403' THEN n := 1; END;
    EXECUTE 'RESET ROLE';
    -- LevelUp organization member who is not staff
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u_m, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN EXECUTE fn; results := results || ('FAIL LevelUp member: ' || fn);
    EXCEPTION WHEN SQLSTATE 'PT403' THEN n := 1; END;
    EXECUTE 'RESET ROLE';
    -- owner of another organization
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN EXECUTE fn; results := results || ('FAIL client owner: ' || fn);
    EXCEPTION WHEN SQLSTATE 'PT403' THEN n := 1; END;
    EXECUTE 'RESET ROLE';
    -- the studio user who made the site
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u_s1, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN EXECUTE fn; results := results || ('FAIL studio user: ' || fn);
    EXCEPTION WHEN SQLSTATE 'PT403' THEN n := 1; END;
    EXECUTE 'RESET ROLE';
    -- anon
    PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN EXECUTE fn; results := results || ('FAIL anon: ' || fn);
    EXCEPTION WHEN insufficient_privilege THEN n := 1; END;
    EXECUTE 'RESET ROLE';
  END LOOP;
  results := results || 'PASS staff on aal1, LevelUp non-staff members, other owners, studio users and anon are refused by every function (6 functions x 5 callers)'::text;
  results := results || (CASE WHEN NOT EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action LIKE 'studio.%' AND actor_id IN (u_m, u_o, u_s1))
    THEN 'PASS' ELSE 'FAIL' END || ' refused calls leave no studio.* audit entry');

  -- ================================================================ studio users: own projects only (re-check)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_s1, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.studio_projects WHERE id IN (p1, p2);
  results := results || (CASE WHEN n = 1 AND EXISTS (SELECT 1 FROM public.studio_projects WHERE id = p1)
    THEN 'PASS' ELSE 'FAIL ' || n END || ' studio user 1 sees their own project, not user 2''s');
  BEGIN PERFORM count(*) FROM private.studio_template_publication; results := results || 'FAIL users read staff publication decisions'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS staff publication decisions are closed to API roles'::text; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_s2, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.studio_projects WHERE id IN (p1, p2);
  results := results || (CASE WHEN n = 1 AND EXISTS (SELECT 1 FROM public.studio_projects WHERE id = p2)
    THEN 'PASS' ELSE 'FAIL ' || n END || ' studio user 2 sees their own project, not user 1''s');
  SELECT count(*) INTO n FROM public.studio_templates WHERE id = 'zz-studio-import';
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' another user''s import stays private');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_m, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.studio_projects WHERE id IN (p1, p2);
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' a LevelUp member who is not staff reads no studio project');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO n FROM public.studio_projects WHERE id IN (p1, p2);
    results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' anon reads no studio project');
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS anon reads no studio project'::text; END;
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO failed FROM unnest(results) r WHERE r LIKE 'FAIL%';
  RAISE EXCEPTION E'% failed, % passed\n%', failed, cardinality(results) - failed, array_to_string(results, E'\n');
END;
$$;
