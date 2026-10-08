-- Ecosystem API tests (site bundle, allowed origins, client onboarding,
-- invitations). Always rolls back; the exception message is the report.
DO $$
DECLARE u_adm uuid := gen_random_uuid(); u_rand uuid := gen_random_uuid(); u_new uuid := gen_random_uuid();
  r text[] := '{}'; j jsonb; ws text; org uuid; n int; res text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES
    (u_adm, 'adm-x@example.invalid', 'authenticated', 'authenticated', now()),
    (u_rand, 'rnd-x@example.invalid', 'authenticated', 'authenticated', now());
  INSERT INTO public.platform_admins (user_id) VALUES (u_adm);

  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.get_site_bundle('ws_d5e600b7dc2ec9a9');
  r := r || (CASE WHEN jsonb_array_length(j->'services') > 0 AND j ? 'blocks' AND NOT (j::text ILIKE '%customer_email%') THEN 'PASS' ELSE 'FAIL' END || ' bundle has services, no customer data');
  r := r || (CASE WHEN public.get_site_bundle('ws_doesnotexist0') IS NULL THEN 'PASS' ELSE 'FAIL' END || ' unknown site -> null');
  PERFORM set_config('request.headers', '{"origin":"https://evil.example"}', true);
  BEGIN PERFORM public.submit_form('ws_d5e600b7dc2ec9a9','contact','Eve','eve@x.com'); r := r || 'FAIL foreign origin accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN r := r || 'PASS foreign origin rejected'::text; END;
  PERFORM set_config('request.headers', '{"origin":"https://finalstop.org"}', true);
  BEGIN PERFORM public.submit_form('ws_d5e600b7dc2ec9a9','contact','Ann','ann@x.com'); r := r || 'PASS own origin accepted'::text;
  EXCEPTION WHEN others THEN r := r || ('FAIL own origin: ' || SQLERRM); END;
  PERFORM set_config('request.headers', '{}', true);
  BEGIN PERFORM public.admin_create_client_site('X', 'X'); r := r || 'FAIL anon created site'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS anon cannot call admin RPC'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub',u_rand,'role','authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.admin_create_client_site('X', 'X'); r := r || 'FAIL user created site'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN r := r || 'PASS non-admin cannot create site'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub',u_adm,'role','authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.admin_create_client_site('Salon Test', 'Salon Élégance Test', NULL, 'https://www.salon-test.com/', 'salon', ARRAY['services','bookings'], 'Owner-New@Example.invalid');
  ws := j->>'website_id'; org := (j->>'organization_id')::uuid;
  r := r || (CASE WHEN ws ~ '^ws_' AND j->>'owner' = 'invited' AND j->'allowed_origins' = '["https://salon-test.com","https://www.salon-test.com"]'::jsonb THEN 'PASS' ELSE 'FAIL ' || j::text END || ' admin creates client + invites owner');
  j := public.admin_update_website(ws, p_features => ARRAY['services','gallery'], p_show_powered_by => false);
  r := r || (CASE WHEN j->'features' = '["gallery","services"]'::jsonb AND (j->>'show_powered_by')::boolean = false THEN 'PASS' ELSE 'FAIL ' || j::text END || ' admin updates features');
  BEGIN PERFORM public.admin_update_website(ws, p_allowed_origins => ARRAY['javascript:alert(1)']); r := r || 'FAIL bad origin accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS invalid origin rejected'::text; END;
  EXECUTE 'RESET ROLE';

  INSERT INTO auth.users (id, email, aud, role) VALUES (u_new, 'owner-new@example.invalid', 'authenticated', 'authenticated');
  SELECT count(*) INTO n FROM public.organization_members WHERE user_id = u_new;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' unverified email gets nothing');
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = u_new;
  SELECT role INTO res FROM public.organization_members WHERE user_id = u_new AND organization_id = org;
  r := r || (CASE WHEN res = 'owner' THEN 'PASS' ELSE 'FAIL got ' || coalesce(res,'none') END || ' verified email becomes owner');

  RAISE EXCEPTION E'API TESTS (rolled back): % failed\n%', (SELECT count(*) FROM unnest(r) x WHERE x LIKE 'FAIL%'), array_to_string(r, E'\n');
END $$;
