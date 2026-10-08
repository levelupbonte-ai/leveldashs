-- Tenant isolation / RLS test suite for the phase 1 foundation.
--
-- Runs entirely inside one DO block and ALWAYS aborts at the end with
-- RAISE EXCEPTION, so nothing it creates is ever committed. The exception
-- message is the test report (look for "FAIL").
--
-- Usage: paste into the Supabase SQL editor (or execute_sql) and read the error.

DO $$
DECLARE
  u_a uuid := gen_random_uuid();   -- owner of org A
  u_b uuid := gen_random_uuid();   -- owner of org B
  u_e uuid := gen_random_uuid();   -- editor in org A
  u_v uuid := gen_random_uuid();   -- viewer in org A
  u_x uuid := gen_random_uuid();   -- signed in, no organization
  org_a uuid;
  org_b uuid;
  ws_a text;
  ws_b text;
  n integer;
  j jsonb;
  results text[] := '{}';
  failed integer := 0;
BEGIN
  -- ---------- helpers (inline) ----------
  -- act as user: set_config + set local role; back to postgres: reset role

  -- ---------- fixtures (as postgres) ----------
  INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data)
  VALUES
    (u_a, 'a@test.local', 'authenticated', 'authenticated', '{"full_name":"Alice"}'),
    (u_b, 'b@test.local', 'authenticated', 'authenticated', '{"name":"Bob"}'),
    (u_e, 'e@test.local', 'authenticated', 'authenticated', '{}'),
    (u_v, 'v@test.local', 'authenticated', 'authenticated', '{}'),
    (u_x, 'x@test.local', 'authenticated', 'authenticated', '{}');

  SELECT count(*) INTO n FROM public.profiles WHERE id IN (u_a, u_b, u_e, u_v, u_x);
  results := results || (CASE WHEN n = 5 THEN 'PASS' ELSE 'FAIL' END || ' profiles auto-created');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT id INTO org_a FROM public.create_organization('Org A', 'org-a');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT id INTO org_b FROM public.create_organization('Org B', 'org-b');
  EXECUTE 'RESET ROLE';

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (org_a, u_e, 'editor'), (org_a, u_v, 'viewer');
  INSERT INTO public.websites (organization_id, name) VALUES (org_a, 'Site A') RETURNING id INTO ws_a;
  INSERT INTO public.websites (organization_id, name) VALUES (org_b, 'Site B') RETURNING id INTO ws_b;
  INSERT INTO public.website_features (website_id, organization_id, feature_key)
  VALUES (ws_a, org_a, 'gallery'), (ws_a, org_a, 'announcements'), (ws_b, org_b, 'bookings');

  results := results || (CASE WHEN ws_a ~ '^ws_[a-z0-9]{16}$' THEN 'PASS' ELSE 'FAIL' END || ' website id format ' || ws_a);

  -- ---------- as owner A ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT count(*) INTO n FROM public.organizations;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' A sees only own org (' || n || ')');

  SELECT count(*) INTO n FROM public.websites;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' A sees only own website (' || n || ')');

  SELECT count(*) INTO n FROM public.website_features;
  results := results || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL' END || ' A sees only own features (' || n || ')');

  SELECT count(*) INTO n FROM public.profiles;
  results := results || (CASE WHEN n = 3 THEN 'PASS' ELSE 'FAIL' END || ' A sees own + co-member profiles only (' || n || ')');

  UPDATE public.websites SET name = 'hacked' WHERE id = ws_b;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' A cannot update org B website');

  UPDATE public.websites SET name = 'Site A renamed' WHERE id = ws_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' A (owner) can rename own website');

  BEGIN
    UPDATE public.websites SET status = 'active' WHERE id = ws_a;
    results := results || 'FAIL A changed website status';
  EXCEPTION WHEN insufficient_privilege THEN
    results := results || 'PASS A cannot change website status';
  END;

  BEGIN
    UPDATE public.websites SET organization_id = org_b WHERE id = ws_a;
    results := results || 'FAIL A moved website to another org';
  EXCEPTION WHEN insufficient_privilege THEN
    results := results || 'PASS A cannot move website to another org';
  END;

  BEGIN
    UPDATE public.organizations SET status = 'active' WHERE id = org_a;
    results := results || 'FAIL A changed org status';
  EXCEPTION WHEN insufficient_privilege THEN
    results := results || 'PASS A cannot change org status';
  END;

  BEGIN
    INSERT INTO public.platform_admins (user_id) VALUES (u_a);
    results := results || 'FAIL A made self platform admin';
  EXCEPTION WHEN insufficient_privilege THEN
    results := results || 'PASS A cannot become platform admin';
  END;

  BEGIN
    INSERT INTO public.website_features (website_id, organization_id, feature_key) VALUES (ws_a, org_a, 'payments');
    results := results || 'FAIL A enabled a feature';
  EXCEPTION WHEN insufficient_privilege THEN
    results := results || 'PASS A cannot enable features';
  END;

  BEGIN
    INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org_b, u_a, 'owner');
    results := results || 'FAIL A joined org B';
  EXCEPTION WHEN insufficient_privilege THEN
    results := results || 'PASS A cannot join org B';
  END;

  BEGIN
    DELETE FROM public.organization_members WHERE organization_id = org_a AND user_id = u_a;
    results := results || 'FAIL last owner removed';
  EXCEPTION WHEN check_violation THEN
    results := results || 'PASS last owner cannot leave';
  END;

  UPDATE public.organization_members SET role = 'admin' WHERE organization_id = org_a AND user_id = u_v;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' owner can promote viewer to admin');

  EXECUTE 'RESET ROLE';

  -- ---------- as admin V (promoted above) ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  BEGIN
    UPDATE public.organization_members SET role = 'owner' WHERE organization_id = org_a AND user_id = u_e;
    results := results || 'FAIL admin granted owner';
  EXCEPTION WHEN insufficient_privilege THEN
    results := results || 'PASS admin cannot grant owner';
  END;

  UPDATE public.organization_members SET role = 'viewer' WHERE organization_id = org_a AND user_id = u_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' admin cannot demote owner');

  EXECUTE 'RESET ROLE';
  UPDATE public.organization_members SET role = 'viewer' WHERE organization_id = org_a AND user_id = u_v;

  -- ---------- as editor E ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
  VALUES (org_a, ws_a, org_a || '/' || ws_a || '/hero.jpg', 'hero.jpg', 'image/jpeg', 1024, u_e);
  results := results || 'PASS editor can add media to own website';

  BEGIN
    INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
    VALUES (org_b, ws_b, org_b || '/' || ws_b || '/x.jpg', 'x.jpg', 'image/jpeg', 1, u_e);
    results := results || 'FAIL editor added media to org B';
  EXCEPTION WHEN insufficient_privilege THEN
    results := results || 'PASS editor cannot add media to org B';
  END;

  BEGIN
    INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
    VALUES (org_a, ws_b, org_a || '/' || ws_b || '/x.jpg', 'x.jpg', 'image/jpeg', 1, u_e);
    results := results || 'FAIL media pointed at another tenant website';
  EXCEPTION WHEN foreign_key_violation THEN
    results := results || 'PASS media cannot reference another tenant website';
  END;

  BEGIN
    INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
    VALUES (org_a, ws_a, org_b || '/' || ws_b || '/x.jpg', 'x.jpg', 'image/jpeg', 1, u_e);
    results := results || 'FAIL media path outside tenant folder';
  EXCEPTION WHEN check_violation THEN
    results := results || 'PASS media path must be inside tenant folder';
  END;

  results := results || (CASE WHEN private.can_access_media_path(org_a || '/' || ws_a || '/a.jpg', 'editor') THEN 'PASS' ELSE 'FAIL' END || ' storage: editor can write own folder');
  results := results || (CASE WHEN NOT private.can_access_media_path(org_b || '/' || ws_b || '/a.jpg', 'editor') THEN 'PASS' ELSE 'FAIL' END || ' storage: editor cannot write org B folder');
  results := results || (CASE WHEN NOT private.can_access_media_path(org_a || '/' || ws_b || '/a.jpg', 'editor') THEN 'PASS' ELSE 'FAIL' END || ' storage: mismatched org/website rejected');
  results := results || (CASE WHEN NOT private.can_access_media_path('../etc/passwd', 'viewer') THEN 'PASS' ELSE 'FAIL' END || ' storage: malformed path rejected');

  BEGIN
    INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org_a, u_x, 'viewer');
    results := results || 'FAIL editor added a member';
  EXCEPTION WHEN insufficient_privilege THEN
    results := results || 'PASS editor cannot add members';
  END;

  EXECUTE 'RESET ROLE';

  -- ---------- as viewer V ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT count(*) INTO n FROM public.media;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' viewer can read org media');

  DELETE FROM public.media;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' viewer cannot delete media');

  results := results || (CASE WHEN NOT private.can_access_media_path(org_a || '/' || ws_a || '/a.jpg', 'editor') THEN 'PASS' ELSE 'FAIL' END || ' storage: viewer cannot write');

  EXECUTE 'RESET ROLE';

  -- ---------- as outsider X ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT (SELECT count(*) FROM public.organizations) + (SELECT count(*) FROM public.websites)
       + (SELECT count(*) FROM public.media) + (SELECT count(*) FROM public.organization_members)
    INTO n;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' outsider sees no tenant data (' || n || ')');

  EXECUTE 'RESET ROLE';

  -- ---------- as anon ----------
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';

  BEGIN
    PERFORM count(*) FROM public.organizations;
    results := results || 'FAIL anon read organizations';
  EXCEPTION WHEN insufficient_privilege THEN
    results := results || 'PASS anon cannot read organizations';
  END;

  BEGIN
    PERFORM public.create_organization('Spam', 'spam');
    results := results || 'FAIL anon created org';
  EXCEPTION WHEN insufficient_privilege THEN
    results := results || 'PASS anon cannot create org';
  END;

  SELECT count(*) INTO n FROM public.features;
  results := results || (CASE WHEN n >= 10 THEN 'PASS' ELSE 'FAIL' END || ' anon can read feature catalog');

  j := public.get_public_website(ws_a);
  results := results || (CASE WHEN j IS NULL THEN 'PASS' ELSE 'FAIL' END || ' draft website is not public');

  EXECUTE 'RESET ROLE';
  UPDATE public.websites SET status = 'active' WHERE id = ws_a;
  EXECUTE 'SET LOCAL ROLE anon';

  j := public.get_public_website(ws_a);
  results := results || (CASE WHEN j ->> 'id' = ws_a AND j -> 'features' = '["announcements","gallery"]'::jsonb THEN 'PASS' ELSE 'FAIL' END || ' active website public config ' || coalesce(j::text, 'null'));

  EXECUTE 'RESET ROLE';

  -- ---------- misc ----------
  results := results || (CASE WHEN to_regprocedure('public.rls_auto_enable()') IS NULL THEN 'PASS' ELSE 'FAIL' END || ' rls_auto_enable not exposed in public');

  SELECT count(*) INTO failed FROM unnest(results) r WHERE r LIKE 'FAIL%';
  RAISE EXCEPTION E'TEST REPORT (rolled back): % failed / % total\n%',
    failed, array_length(results, 1), array_to_string(results, E'\n');
END;
$$;
