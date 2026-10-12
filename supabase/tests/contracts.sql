-- Contracts, signatures and the dashboard gate (migration contracts). Always rolls
-- back; the exception message is the report and must show `0 failed`.
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE
  u_a uuid := gen_random_uuid();   -- owner of org A
  u_v uuid := gen_random_uuid();   -- viewer of org A
  u_b uuid := gen_random_uuid();   -- owner of org B
  u_p uuid := gen_random_uuid();   -- LevelUp staff
  org_a uuid; org_b uuid; ws_a text; c1 uuid; c2 uuid; h text; n integer; j jsonb; s text; b boolean;
  results text[] := '{}';
  failed integer;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (u_a, 'a@t.l', 'authenticated', 'authenticated'), (u_v, 'v@t.l', 'authenticated', 'authenticated'),
    (u_b, 'b@t.l', 'authenticated', 'authenticated'), (u_p, 'p@t.l', 'authenticated', 'authenticated');
  INSERT INTO public.platform_admins (user_id) VALUES (u_p);
  INSERT INTO public.organizations (name, slug) VALUES ('Org A', 'zz-contract-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('Org B', 'zz-contract-b') RETURNING id INTO org_b;
  INSERT INTO public.organization_members VALUES (org_a, u_a, 'owner'), (org_a, u_v, 'viewer'), (org_b, u_b, 'owner');
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'Site A', 'active') RETURNING id INTO ws_a;
  INSERT INTO public.services (website_id, organization_id, slug, name) VALUES (ws_a, org_a, 'cut', 'Cut');
  UPDATE public.profiles SET full_name = 'Alice Owner' WHERE id IN (u_a, u_v);

  -- Staff: create + send a required contract for org A.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  c1 := public.admin_create_contract(org_a, 'msa', ws_a, 'fr',
    '{"projectName":"Site A","scope":["Home","Booking"],"buildPrice":2400,"monthlyPrice":79,"startDate":"2026-11-02","evil":"<x>"}'::jsonb, true);
  SELECT c.order_form ? 'evil', c.locale INTO b, s FROM public.contracts c WHERE c.id = c1;
  results := results || (CASE WHEN b = false AND s = 'fr' AND (SELECT translated_body IS NOT NULL AND template_version = 1 FROM public.contracts WHERE id = c1) THEN 'PASS' ELSE 'FAIL' END || ' draft from template, unknown order-form keys dropped');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.contracts WHERE id = c1;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' client cannot see drafts');
  results := results || (CASE WHEN public.org_access_state(org_a) = 'active' THEN 'PASS' ELSE 'FAIL' END || ' draft does not lock');
  BEGIN PERFORM public.admin_send_contract(c1); results := results || 'FAIL client sent a contract'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS client cannot call staff RPCs'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.admin_send_contract(c1);
  results := results || (CASE WHEN j->'recipients' @> '[{"email":"a@t.l"}]' AND NOT j->'recipients' @> '[{"email":"v@t.l"}]' THEN 'PASS' ELSE 'FAIL' END || ' send notifies owners/admins only');
  results := results || (CASE WHEN public.org_access_state(org_a) = 'active' THEN 'PASS' ELSE 'FAIL' END || ' staff never locked');
  UPDATE public.services SET badge = 'Staff' WHERE website_id = ws_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' staff can still edit content');
  EXECUTE 'RESET ROLE';

  SELECT document_hash INTO h FROM public.contracts WHERE id = c1;
  results := results || (CASE WHEN h = private.contract_document_hash(
    (SELECT body FROM public.contracts WHERE id = c1), (SELECT translated_body FROM public.contracts WHERE id = c1),
    (SELECT order_form FROM public.contracts WHERE id = c1)) AND (SELECT order_form->>'client' FROM public.contracts WHERE id = c1) = 'Org A'
    THEN 'PASS' ELSE 'FAIL' END || ' sha-256 of snapshot stored, client name frozen');
  BEGIN UPDATE public.contracts SET body = 'tampered' WHERE id = c1; results := results || 'FAIL sent body edited'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS sent snapshot frozen (even for the table owner)'::text; END;

  -- Client while locked.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.org_access_state(org_a) = 'contract_required' THEN 'PASS' ELSE 'FAIL' END || ' owner: contract_required');
  j := public.dashboard_access(NULL);
  results := results || (CASE WHEN (j->>'organization_id')::uuid = org_a AND j->>'state' = 'contract_required' AND (j->>'has_contracts')::boolean THEN 'PASS' ELSE 'FAIL' END || ' dashboard_access resolves the default org');
  UPDATE public.services SET badge = 'x' WHERE website_id = ws_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' content update refused while unsigned');
  BEGIN INSERT INTO public.services (website_id, organization_id, slug, name) VALUES (ws_a, org_a, 'new', 'New'); results := results || 'FAIL content insert while locked'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS content insert refused while unsigned'::text; END;
  BEGIN INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('media', org_a::text || '/' || ws_a || '/x.png', u_a); results := results || 'FAIL media upload while locked'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS media upload refused while unsigned'::text; END;
  UPDATE public.organizations SET name = 'Org A' WHERE id = org_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' organization (logo/name) still editable');
  BEGIN INSERT INTO public.contract_signatures (contract_id, organization_id, user_id, signer_email, signer_name, signer_title, consent, document_hash)
    VALUES (c1, org_a, u_a, 'a@t.l', 'Alice', 'Owner', true, h); results := results || 'FAIL direct signature insert'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS no direct signature insert'::text; END;
  BEGIN UPDATE public.contracts SET status = 'signed' WHERE id = c1; results := results || 'FAIL client updated contract'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS client cannot update contracts'::text; END;
  BEGIN PERFORM public.sign_contract(c1, 'Alice Owner', 'Owner', NULL, false, h); results := results || 'FAIL signed without consent'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS consent required'::text; END;
  BEGIN PERFORM public.sign_contract(c1, 'Alice Owner', 'Owner', NULL, true, repeat('0', 64)); results := results || 'FAIL wrong hash accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT409' THEN results := results || 'PASS hash must match'::text; END;
  BEGIN PERFORM public.sign_contract(c1, 'Alice Owner', 'Owner', '<svg onload=x>', true, h); results := results || 'FAIL markup accepted as signature'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS drawn signature must be path data'::text; END;
  BEGIN PERFORM public.sign_contract(c1, 'A', 'Owner', NULL, true, h); results := results || 'FAIL 1-letter name'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS full name required'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.org_access_state(org_a) = 'contract_required' THEN 'PASS' ELSE 'FAIL' END || ' viewer locked too');
  BEGIN PERFORM public.sign_contract(c1, 'Victor Viewer', 'Staff', NULL, true, h); results := results || 'FAIL viewer signed'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS only owners/admins sign'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.contracts WHERE organization_id = org_a;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' other org cannot read contracts');
  results := results || (CASE WHEN public.org_access_state(org_a) IS NULL THEN 'PASS' ELSE 'FAIL' END || ' no state for non-members');
  BEGIN PERFORM public.sign_contract(c1, 'Bob Other', 'Owner', NULL, true, h); results := results || 'FAIL other org signed'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS other org cannot sign'::text; END;
  EXECUTE 'RESET ROLE';

  -- Sign (IP and user agent from the request headers).
  PERFORM set_config('request.headers', '{"x-forwarded-for":"203.0.113.7, 10.0.0.1","user-agent":"TestAgent/1.0"}', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.sign_contract(c1, '  Alice Owner ', 'Owner', 'M 10 10 L 20 20 L 30 15', true, h);
  SELECT count(*) INTO n FROM public.contract_signatures
    WHERE contract_id = c1 AND ip = '203.0.113.7'::inet AND user_agent = 'TestAgent/1.0' AND signer_name = 'Alice Owner' AND document_hash = h AND user_id = u_a;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' signature recorded with IP, UA, hash');
  results := results || (CASE WHEN (SELECT status FROM public.contracts WHERE id = c1) = 'signed' AND public.org_access_state(org_a) = 'active' THEN 'PASS' ELSE 'FAIL' END || ' signed contract unlocks');
  UPDATE public.services SET badge = 'Ok' WHERE website_id = ws_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' content editable after signing');
  BEGIN PERFORM public.sign_contract(c1, 'Alice Owner', 'Owner', NULL, true, h); results := results || 'FAIL signed twice'::text;
  EXCEPTION WHEN SQLSTATE 'PT409' THEN results := results || 'PASS cannot sign twice'::text; END;
  BEGIN UPDATE public.contract_signatures SET signer_name = 'Mallory' WHERE contract_id = c1; results := results || 'FAIL client updated signature'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS client cannot update signatures'::text; END;
  BEGIN DELETE FROM public.contract_signatures WHERE contract_id = c1; results := results || 'FAIL client deleted signature'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS client cannot delete signatures'::text; END;
  results := results || (CASE WHEN public.mark_contract_emailed(c1) AND NOT public.mark_contract_emailed(c1) THEN 'PASS' ELSE 'FAIL' END || ' signed copy e-mailed once');
  results := results || (CASE WHEN private.can_store_contract_pdf(org_a::text || '/' || c1::text || '.pdf')
    AND NOT private.can_store_contract_pdf(org_b::text || '/' || c1::text || '.pdf') THEN 'PASS' ELSE 'FAIL' END || ' PDF path bound to the contract');
  EXECUTE 'RESET ROLE';

  BEGIN UPDATE public.contract_signatures SET signer_name = 'Mallory' WHERE contract_id = c1; results := results || 'FAIL owner updated signature'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS signatures immutable (even for the table owner)'::text; END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN NOT private.can_store_contract_pdf(org_a::text || '/' || c1::text || '.pdf') THEN 'PASS' ELSE 'FAIL' END || ' viewer cannot store the PDF');
  SELECT count(*) INTO n FROM public.contract_signatures WHERE contract_id = c1;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' members read the certificate');
  EXECUTE 'RESET ROLE';

  -- New template version: staff re-issue, client re-signs, old signature kept.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  n := public.admin_publish_contract_template('msa', 'en', 'Master Services Agreement', 'Version two text.');
  c2 := public.admin_reissue_contract(c1);
  SELECT template_version INTO failed FROM public.contracts WHERE id = c2;
  results := results || (CASE WHEN failed = n AND n >= 2 THEN 'PASS' ELSE 'FAIL' END || ' re-issue uses the newest version');
  PERFORM public.admin_send_contract(c2);
  BEGIN UPDATE public.contract_templates SET body = 'x' WHERE version = n AND key = 'msa'; GET DIAGNOSTICS failed = ROW_COUNT;
    results := results || (CASE WHEN failed = 0 THEN 'PASS' ELSE 'FAIL' END || ' templates not writable through the API');
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS templates not writable through the API'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.org_access_state(org_a) = 'contract_required' THEN 'PASS' ELSE 'FAIL' END || ' new version must be signed again');
  SELECT document_hash INTO h FROM public.contracts WHERE id = c2;
  PERFORM public.sign_contract(c2, 'Alice Owner', 'Owner', NULL, true, h);
  SELECT count(*) INTO n FROM public.contract_signatures WHERE organization_id = org_a;
  results := results || (CASE WHEN n = 2 AND (SELECT status FROM public.contracts WHERE id = c1) = 'superseded'
    AND (SELECT superseded_by FROM public.contracts WHERE id = c1) = c2 THEN 'PASS' ELSE 'FAIL' END || ' old version superseded, both signatures kept');
  EXECUTE 'RESET ROLE';

  -- Blocking setup tasks.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.admin_set_required_tasks(org_a, array['profile', 'logo', 'bogus']);
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.organization_required_tasks WHERE organization_id = org_a AND required;
  results := results || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL' END || ' unknown task keys ignored');
  UPDATE public.profiles SET full_name = NULL WHERE id = u_a;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.dashboard_access(org_a);
  results := results || (CASE WHEN j->>'state' = 'tasks_required' AND j->'pending_tasks' = '["logo", "profile"]'::jsonb THEN 'PASS' ELSE 'FAIL' END || ' tasks_required with pending list');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.org_access_state(org_a) = 'active' THEN 'PASS' ELSE 'FAIL' END || ' logo task does not hold viewers');
  EXECUTE 'RESET ROLE';
  UPDATE public.profiles SET full_name = 'Alice Owner' WHERE id = u_a;
  UPDATE public.organizations SET logo_url = 'https://example.com/logo.webp' WHERE id = org_a;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.org_access_state(org_a) = 'active' THEN 'PASS' ELSE 'FAIL' END || ' tasks done -> active');
  EXECUTE 'RESET ROLE';

  -- Existing organizations without a contract are not affected.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.org_access_state(org_b) = 'active' THEN 'PASS' ELSE 'FAIL' END || ' org without contract stays active');
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO failed FROM unnest(results) r WHERE r LIKE 'FAIL%';
  RAISE EXCEPTION E'% failed\n%', failed, array_to_string(results, E'\n');
END $$;
