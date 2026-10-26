-- Invoices, receipts, the plan storage limit and the online payment webhook
-- (migrations billing_invoices, media_storage_limit, billing_online_payments).
-- Always rolls back; the exception message is the report and must show `0 failed`.
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE
  u_o uuid := gen_random_uuid();   -- owner of org A
  u_a uuid := gen_random_uuid();   -- admin of org A
  u_e uuid := gen_random_uuid();   -- editor of org A
  u_v uuid := gen_random_uuid();   -- viewer of org A
  u_b uuid := gen_random_uuid();   -- owner of org B
  u_p uuid := gen_random_uuid();   -- LevelUp staff
  staff_aal2 text; staff_aal1 text;
  org_a uuid; org_b uuid; ws_a text; ws_b text;
  base_a text; p1 text; p2 text; p3 text;
  c1 uuid; c2 uuid; c3 uuid; c_void uuid; c_b uuid; c_ov uuid;
  yr text := extract(year from (now() at time zone 'America/Toronto'))::text;
  start_n integer; nums integer[] := '{}'; num text; n integer; i integer;
  j jsonb; k text; k_old text; s text; sess text; paid_at_1 timestamptz;
  results text[] := '{}';
  failed integer;
BEGIN
  -- Known state for the run (rolled back): empty issuer, current counter.
  UPDATE public.billing_issuers SET legal_name = NULL, address = NULL, email = NULL, tax_id = NULL WHERE key = 'levelup';
  SELECT coalesce((SELECT last_number FROM private.invoice_counters WHERE issuer_key = 'levelup' AND year = yr::int), 0) INTO start_n;
  INSERT INTO public.plans (key, name, price_monthly, currency, limits, sort_order)
  VALUES ('zz_tiny', 'Zz Tiny', 0, 'usd', '{"media_mb": 1, "team_members": null}', 99);

  INSERT INTO auth.users (id, email, aud, role) VALUES
    (u_o, 'owner@zz-inv.test', 'authenticated', 'authenticated'),
    (u_a, 'admin@zz-inv.test', 'authenticated', 'authenticated'),
    (u_e, 'editor@zz-inv.test', 'authenticated', 'authenticated'),
    (u_v, 'viewer@zz-inv.test', 'authenticated', 'authenticated'),
    (u_b, 'owner-b@zz-inv.test', 'authenticated', 'authenticated'),
    (u_p, 'staff@zz-inv.test', 'authenticated', 'authenticated');
  INSERT INTO public.platform_admins (user_id) VALUES (u_p);
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Invoices A', 'zz-inv-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Invoices B', 'zz-inv-b') RETURNING id INTO org_b;
  INSERT INTO public.organization_members VALUES
    (org_a, u_o, 'owner'), (org_a, u_a, 'admin'), (org_a, u_e, 'editor'), (org_a, u_v, 'viewer'), (org_b, u_b, 'owner');
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'Site A', 'active') RETURNING id INTO ws_a;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_b, 'Site B', 'active') RETURNING id INTO ws_b;
  staff_aal2 := json_build_object('sub', u_p, 'role', 'authenticated', 'email', 'staff@zz-inv.test', 'aal', 'aal2')::text;
  staff_aal1 := json_build_object('sub', u_p, 'role', 'authenticated', 'email', 'staff@zz-inv.test', 'aal', 'aal1')::text;

  -- ================================================================ numbering
  PERFORM set_config('request.jwt.claims', staff_aal2, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.admin_create_charge(org_a, 'setup', 'Website setup', NULL, 120000, 'usd', current_date + 10);
  c1 := (j->>'id')::uuid;
  results := results || (CASE WHEN j->>'invoice_number' = 'LU-' || yr || '-' || lpad((start_n + 1)::text, 4, '0')
      AND (j->>'issued_on')::date = (now() at time zone 'America/Toronto')::date
    THEN 'PASS' ELSE 'FAIL ' || coalesce(j->>'invoice_number', 'null') END || ' first charge numbered LU-<year>-<4 digits> by the database');
  -- A refused charge never takes a number.
  BEGIN PERFORM public.admin_create_charge(org_a, 'one_off', 'Bad', NULL, -5, 'usd'); results := results || 'FAIL negative amount accepted'::text;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM public.admin_create_charge(org_a, 'subscription', 'No price'); results := results || 'FAIL subscription without price'::text;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  -- Repeated calls, two organizations: one sequence per issuer.
  FOR i IN 1..20 LOOP
    j := public.admin_create_charge(CASE WHEN i % 3 = 0 THEN org_b ELSE org_a END, 'one_off', 'Item ' || i, NULL, 1000 + i, 'usd', current_date + 5);
    IF i = 3 THEN c_b := (j->>'id')::uuid; END IF;
    IF i = 4 THEN c2 := (j->>'id')::uuid; END IF;
    IF i = 5 THEN c_void := (j->>'id')::uuid; END IF;
    IF i = 7 THEN c3 := (j->>'id')::uuid; END IF;
  END LOOP;
  j := public.admin_create_charge(org_a, 'one_off', 'Overdue item', NULL, 5000, 'usd', current_date - 3);
  c_ov := (j->>'id')::uuid;
  EXECUTE 'RESET ROLE';
  SELECT array_agg(split_part(invoice_number, '-', 3)::int ORDER BY created_at, invoice_number) INTO nums
  FROM public.billing_charges WHERE organization_id IN (org_a, org_b);
  results := results || (CASE WHEN cardinality(nums) = 22 AND nums[1] = start_n + 1 AND nums[22] = start_n + 22
      AND (SELECT count(DISTINCT x) FROM unnest(nums) x) = 22
      AND (SELECT bool_and(x = start_n + o) FROM unnest(nums) WITH ORDINALITY AS t(x, o))
    THEN 'PASS' ELSE 'FAIL ' || array_to_string(nums, ',') END || ' 22 charges: sequential, no gaps (refused charges took no number), no duplicates');
  results := results || (CASE WHEN (SELECT last_number FROM private.invoice_counters WHERE issuer_key = 'levelup' AND year = yr::int) = start_n + 22
    THEN 'PASS' ELSE 'FAIL' END || ' counter row matches the last number issued');

  SELECT invoice_number INTO num FROM public.billing_charges WHERE id = c2;
  UPDATE public.billing_charges SET invoice_number = 'LU-1999-9999', issued_on = '1999-01-01' WHERE id = c2;
  results := results || (CASE WHEN (SELECT invoice_number = num AND issued_on <> '1999-01-01' FROM public.billing_charges WHERE id = c2)
    THEN 'PASS' ELSE 'FAIL' END || ' an invoice number and issue date never change');
  BEGIN
    INSERT INTO public.billing_charges (organization_id, label, kind, base_amount, currency, invoice_number)
    VALUES (org_a, 'Forced', 'one_off', 1, 'usd', 'LU-' || yr || '-0001');
    results := results || (CASE WHEN (SELECT invoice_number FROM public.billing_charges WHERE label = 'Forced' AND organization_id = org_a) = 'LU-' || yr || '-' || lpad((start_n + 23)::text, 4, '0')
      THEN 'PASS' ELSE 'FAIL' END || ' a number given by the caller is replaced by the next one');
  END;

  PERFORM set_config('request.jwt.claims', staff_aal2, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.admin_update_charge(c2, 'Item 4 (edited)', NULL, 2000, current_date + 7);
  results := results || (CASE WHEN j->>'invoice_number' = num THEN 'PASS' ELSE 'FAIL' END || ' editing a due charge keeps its number');
  j := public.admin_void_charge(c_void, 'Duplicate');
  results := results || (CASE WHEN j->>'status' = 'void' AND j->>'invoice_number' IS NOT NULL THEN 'PASS' ELSE 'FAIL' END || ' a voided charge keeps its number');
  EXECUTE 'RESET ROLE';

  -- ================================================================ clients cannot write
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.admin_record_charge_payment(c1, 'cash'); results := results || 'FAIL owner recorded a payment'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS clients cannot record payments'::text; END;
  BEGIN PERFORM public.admin_save_billing_issuer('Me', 'Here', 'me@zz-inv.test'); results := results || 'FAIL owner edited the issuer'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS clients cannot edit the issuer details'::text; END;
  BEGIN PERFORM 1 FROM private.invoice_counters; results := results || 'FAIL client read the counters'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS clients cannot read the invoice counters'::text; END;
  BEGIN UPDATE public.billing_charges SET invoice_number = 'X' WHERE id = c1; results := results || 'FAIL client updated a charge'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS clients cannot change a charge'::text; END;
  j := public.billing_summary(org_a);
  results := results || (CASE WHEN (j->'money'->>'documents_ready')::boolean = false
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'money'->'charges') c WHERE (c->>'id')::uuid = c1 AND c->>'invoice_number' LIKE 'LU-%')
    THEN 'PASS' ELSE 'FAIL' END || ' owner sees invoice numbers; documents not ready while the issuer is empty');
  EXECUTE 'RESET ROLE';

  -- ================================================================ issuer (staff)
  PERFORM set_config('request.jwt.claims', staff_aal2, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.admin_get_billing_issuer();
  results := results || (CASE WHEN NOT (j->>'ready')::boolean AND j->>'legal_name' IS NULL AND j->>'invoice_prefix' = 'LU'
    THEN 'PASS' ELSE 'FAIL' END || ' issuer starts empty: nothing invented, not ready');
  BEGIN PERFORM public.admin_save_billing_issuer('Zz Legal', 'Line 1', 'not-an-email'); results := results || 'FAIL bad issuer email'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'invalid_email' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' issuer e-mail validated'); END;
  BEGIN PERFORM public.admin_save_billing_issuer('<b>Zz</b>', 'Line 1', 'billing@zz-inv.test'); results := results || 'FAIL markup in legal name'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS markup refused in issuer details'::text; END;
  j := public.admin_save_billing_issuer('Zz Legal Name LLC', E'1 Test Street\nTest City', 'Billing@zz-inv.test', NULL);
  results := results || (CASE WHEN (j->>'ready')::boolean AND j->>'email' = 'billing@zz-inv.test' AND j->>'address' = E'1 Test Street\nTest City'
    THEN 'PASS' ELSE 'FAIL' END || ' staff complete the issuer (multi-line address, e-mail lower-cased): ready');
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'billing.issuer_updated' AND actor_id = u_p AND (metadata->>'ready')::boolean)
    THEN 'PASS' ELSE 'FAIL' END || ' issuer change audited');
  PERFORM set_config('request.jwt.claims', staff_aal1, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.admin_get_billing_issuer(); results := results || 'FAIL aal1 staff read the issuer settings'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS staff need aal2 for the issuer settings'::text; END;
  EXECUTE 'RESET ROLE';

  -- ================================================================ documents: who can read
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.billing_charge_document(c1);
  results := results || (CASE WHEN j->'organization'->>'name' = 'Zz Invoices A' AND j->'charge'->>'invoice_number' LIKE 'LU-%'
      AND (j->>'issuer_ready')::boolean AND j->'issuer'->>'legal_name' = 'Zz Legal Name LLC' AND NOT (j->>'staff')::boolean
      AND (j->'charge'->>'amount')::int = 120000 AND j->'charge'->>'payment_method' IS NULL
    THEN 'PASS' ELSE 'FAIL ' || j::text END || ' owner reads the invoice of its charge (issuer, organization, number, amount)');
  j := public.billing_summary(org_a);
  results := results || (CASE WHEN (j->'money'->>'documents_ready')::boolean THEN 'PASS' ELSE 'FAIL' END || ' documents ready once the issuer is complete');
  j := public.billing_charge_document(c_void);
  results := results || (CASE WHEN j->'charge'->>'status' = 'void' AND j->'charge'->>'invoice_number' IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END || ' a voided invoice is still readable, with its number and status void');
  BEGIN PERFORM public.billing_charge_document(c_b); results := results || 'FAIL owner A read org B invoice'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN results := results || 'PASS owner of A cannot read an invoice of B (charge_not_found)'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN (public.billing_charge_document(c1)->'charge'->>'id')::uuid = c1 THEN 'PASS' ELSE 'FAIL' END || ' admins of the organization read its documents');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.billing_charge_document(c1); results := results || 'FAIL viewer read an invoice'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN results := results || 'PASS viewers cannot download invoices or receipts'::text; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.billing_charge_document(c1); results := results || 'FAIL editor read an invoice'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN results := results || 'PASS editors cannot download invoices or receipts'::text; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.billing_charge_document(c1); results := results || 'FAIL owner B read org A invoice'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN results := results || 'PASS another organization cannot read the invoice'::text; END;
  BEGIN PERFORM public.billing_charge_document(gen_random_uuid()); results := results || 'FAIL unknown id'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN results := results || 'PASS unknown and foreign ids answer the same (nothing to probe)'::text; END;
  results := results || (CASE WHEN (public.billing_charge_document(c_b)->'organization'->>'name') = 'Zz Invoices B' THEN 'PASS' ELSE 'FAIL' END || ' owner B reads its own invoice');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM public.billing_charge_document(c1); results := results || 'FAIL anon read an invoice'::text;
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE 'PT401' THEN results := results || 'PASS anon cannot read documents'::text; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', staff_aal1, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.billing_charge_document(c1); results := results || 'FAIL aal1 staff read an invoice'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN results := results || 'PASS staff on aal1 cannot read documents'::text; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', staff_aal2, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.billing_charge_document(c_b);
  results := results || (CASE WHEN (j->>'staff')::boolean AND j->'organization'->>'name' = 'Zz Invoices B' THEN 'PASS' ELSE 'FAIL' END || ' staff (aal2) read any organization''s documents');

  -- ================================================================ receipts
  BEGIN PERFORM public.admin_record_charge_payment(c1, 'cheque'); results := results || 'FAIL unknown method'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'invalid_method' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' payment method must be cash / bank transfer / mobile money / card / other'); END;
  BEGIN PERFORM public.admin_record_charge_payment(c1, 'cash', current_date + 5); results := results || 'FAIL future paid date'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'invalid_date' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' paid date in the future refused'); END;
  BEGIN PERFORM public.admin_record_charge_payment(c_void, 'cash'); results := results || 'FAIL paid a void charge'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'charge_closed' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' a void charge cannot be paid'); END;
  j := public.admin_record_charge_payment(c1, 'bank_transfer', (now() at time zone 'America/Toronto')::date - 2, '  TR-2026-104 ', 'Thanks');
  results := results || (CASE WHEN j->>'status' = 'paid' AND j->>'payment_method' = 'bank_transfer' AND j->>'payment_reference' = 'TR-2026-104'
      AND (j->>'paid_amount')::int = 120000
      AND ((j->>'paid_at')::timestamptz AT TIME ZONE 'America/Toronto')::date = (now() at time zone 'America/Toronto')::date - 2
    THEN 'PASS' ELSE 'FAIL ' || j::text END || ' mark paid records method, paid date (no time-zone shift), reference and amount');
  j := public.admin_record_charge_payment(c1, 'cash');
  results := results || (CASE WHEN j->>'payment_method' = 'bank_transfer' THEN 'PASS' ELSE 'FAIL' END || ' recording again does not overwrite the receipt');
  j := public.admin_mark_charge_paid(c3, NULL, 'Old call');
  results := results || (CASE WHEN j->>'status' = 'paid' AND j->>'payment_method' = 'other' THEN 'PASS' ELSE 'FAIL' END || ' the older mark-paid call records method other');
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'billing.charge_paid' AND target_id = org_a::text
      AND metadata->>'method' = 'bank_transfer' AND (metadata->>'has_reference')::boolean AND actor_id = u_p)
    THEN 'PASS' ELSE 'FAIL' END || ' payment audited with its method');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.billing_charge_document(c1);
  results := results || (CASE WHEN j->'charge'->>'status' = 'paid' AND j->'charge'->>'payment_method' = 'bank_transfer'
      AND j->'charge'->>'payment_reference' = 'TR-2026-104' AND j->'charge'->>'paid_at' IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END || ' after mark-paid the owner gets the receipt data (method, date, reference)');
  EXECUTE 'RESET ROLE';

  -- ================================================================ storage limit
  INSERT INTO public.organization_billing (organization_id, plan_key) VALUES (org_a, 'zz_tiny');
  base_a := 'org/' || org_a || '/site/' || ws_a || '/2026/10/';
  p1 := base_a || gen_random_uuid() || '.webp';
  p2 := base_a || gen_random_uuid() || '.webp';
  p3 := base_a || gen_random_uuid() || '.webp';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.media_check_upload(ws_a, 600000);
  results := results || 'PASS a file inside the plan is accepted by the pre-check'::text;
  BEGIN
    PERFORM public.media_check_upload(ws_a, 2000000);
    results := results || 'FAIL 2 MB accepted on a 1 MB plan'::text;
  EXCEPTION WHEN SQLSTATE 'PT402' THEN
    GET STACKED DIAGNOSTICS s = PG_EXCEPTION_DETAIL;
    results := results || (CASE WHEN SQLERRM = 'plan_limit_reached' AND (s::jsonb)->>'key' = 'media_mb' AND ((s::jsonb)->>'limit')::int = 1
      AND (s::jsonb)->>'plan' = 'zz_tiny'
      THEN 'PASS' ELSE 'FAIL ' || coalesce(s, '') END || ' pre-check refuses a file over the plan: plan_limit_reached with key media_mb');
  END;
  INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('media', p1, u_e, '{"size": 600000, "mimetype": "image/webp"}');
  INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
  VALUES (org_a, ws_a, p1, 'one.webp', 'image/webp', 1, u_e);
  results := results || (CASE WHEN (SELECT size_bytes FROM public.media WHERE storage_path = p1) = 600000 THEN 'PASS' ELSE 'FAIL' END || ' upload within the limit registered (size from Storage)');
  -- Second file: Storage still accepts it (usage below the limit) but the registration
  -- sees 1.2 MB stored and refuses it.
  INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('media', p2, u_e, '{"size": 600000, "mimetype": "image/webp"}');
  BEGIN
    INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
    VALUES (org_a, ws_a, p2, 'two.webp', 'image/webp', 1, u_e);
    results := results || 'FAIL registration over the plan'::text;
  EXCEPTION WHEN SQLSTATE 'PT402' THEN
    GET STACKED DIAGNOSTICS s = PG_EXCEPTION_DETAIL;
    results := results || (CASE WHEN SQLERRM = 'plan_limit_reached' AND (s::jsonb)->>'key' = 'media_mb'
      THEN 'PASS' ELSE 'FAIL ' || coalesce(s, '') END || ' registering a file that goes past media_mb is refused (plan_limit_reached)');
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('media', p3, u_e, '{"size": 10, "mimetype": "image/webp"}');
    results := results || 'FAIL storage accepted an upload over the plan'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS Storage refuses new objects once the organization is over its plan'::text; END;
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'media' AND name = p1)
      AND jsonb_array_length(public.media_list(ws_a)->'rows') = 1
    THEN 'PASS' ELSE 'FAIL' END || ' existing files stay listed and readable over the limit');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.media_check_upload(ws_a, 1); results := results || 'FAIL viewer pre-check'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS viewers cannot upload (pre-check)'::text; END;
  j := public.billing_usage(org_a);
  results := results || (CASE WHEN (j->>'storage_bytes')::bigint = 1200000 AND (j->>'media_files')::int = 2
    THEN 'PASS' ELSE 'FAIL ' || j::text END || ' billing storage usage comes from the stored objects (org_storage_usage), refused upload included until removed');
  j := public.billing_summary(org_a);
  results := results || (CASE WHEN (SELECT (u->>'used')::numeric FROM jsonb_array_elements(j->'usage') u WHERE u->>'key' = 'media_mb') = 1.1
    THEN 'PASS' ELSE 'FAIL ' || (j->'usage')::text END || ' media_mb meter uses the same number');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.media_check_upload(ws_b, 2000000);
  results := results || 'PASS another organization keeps its own (larger) limit'::text;
  BEGIN PERFORM public.media_check_upload(ws_a, 1); results := results || 'FAIL B pre-checked A website'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS pre-check refuses another organization''s website'::text; END;
  EXECUTE 'RESET ROLE';

  -- ================================================================ online payments: key
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.admin_create_billing_webhook_key(); results := results || 'FAIL client created a webhook key'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS only staff create the billing webhook key'::text; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', staff_aal2, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  k_old := public.admin_create_billing_webhook_key()->>'key';
  j := public.admin_create_billing_webhook_key();
  k := j->>'key';
  results := results || (CASE WHEN k ~ '^lu_bill_[0-9a-f]{48}$' AND j->>'key_hint' = right(k, 4)
      AND (public.admin_billing_webhook_key_status()->>'active')::boolean
      AND public.admin_billing_webhook_key_status()->>'key_hint' = right(k, 4)
      AND NOT (public.admin_billing_webhook_key_status() ? 'key')
    THEN 'PASS' ELSE 'FAIL' END || ' staff get a lu_bill_ key once; status shows the hint only');
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN (SELECT count(*) FROM private.billing_webhook_keys WHERE revoked_at IS NULL) = 1
      AND EXISTS (SELECT 1 FROM private.billing_webhook_keys WHERE key_hash = encode(extensions.digest(k, 'sha256'), 'hex') AND revoked_at IS NULL)
      AND EXISTS (SELECT 1 FROM private.billing_webhook_keys WHERE key_hash = encode(extensions.digest(k_old, 'sha256'), 'hex') AND revoked_at IS NOT NULL)
      AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'billing.webhook_key_created' AND actor_id = u_p AND metadata::text NOT LIKE '%' || k || '%')
    THEN 'PASS' ELSE 'FAIL' END || ' one active key, stored as a hash, creation audited without the key');

  -- ================================================================ checkout
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.billing_checkout_prepare(c2);
  results := results || (CASE WHEN (j->>'amount')::int = 2000 AND j->>'currency' = 'usd' AND (j->>'attempt')::int = 1
      AND (j->>'organization_id')::uuid = org_a AND (j->>'expires_at')::timestamptz > now() + interval '55 minutes'
    THEN 'PASS' ELSE 'FAIL ' || j::text END || ' owner prepares a checkout: exact amount from the database, attempt 1');
  results := results || (CASE WHEN (public.billing_checkout_prepare(c2)->>'attempt')::int = 1 THEN 'PASS' ELSE 'FAIL' END || ' a double click reuses the same attempt (same idempotency key)');
  results := results || (CASE WHEN (public.billing_checkout_prepare(c_ov)->>'amount')::int = 5000 THEN 'PASS' ELSE 'FAIL' END || ' an overdue charge can be paid online');
  BEGIN PERFORM public.billing_checkout_prepare(c1); results := results || 'FAIL checkout of a paid charge'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'charge_closed' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' no checkout for a paid charge'); END;
  BEGIN PERFORM public.billing_checkout_prepare(c_void); results := results || 'FAIL checkout of a void charge'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'charge_closed' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' no checkout for a void charge'); END;
  BEGIN PERFORM public.billing_checkout_prepare(c_b); results := results || 'FAIL checkout of another org charge'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN results := results || 'PASS no checkout for another organization''s charge'::text; END;
  sess := 'cs_test_' || md5(c2::text);
  PERFORM public.billing_checkout_record(c2, 1, sess);
  results := results || (CASE WHEN public.billing_checkout_prepare(c2)->>'session_id' = sess THEN 'PASS' ELSE 'FAIL' END || ' the open session is handed back while it lives');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.billing_checkout_prepare(c2); results := results || 'FAIL viewer started a checkout'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN results := results || 'PASS viewers cannot pay online'::text; END;
  EXECUTE 'RESET ROLE';

  -- ================================================================ webhook
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM public.billing_ingest_stripe_event('lu_bill_' || repeat('0', 48), '{}'); results := results || 'FAIL unknown key accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN results := results || 'PASS webhook refuses an unknown key'::text; END;
  BEGIN PERFORM public.billing_ingest_stripe_event('sk_live_whatever', '{}'); results := results || 'FAIL malformed key accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN results := results || 'PASS webhook refuses a malformed key'::text; END;
  BEGIN PERFORM public.billing_ingest_stripe_event(k_old, '{}'); results := results || 'FAIL revoked key accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN results := results || 'PASS webhook refuses the previous (revoked) key'::text; END;
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('event_id', 'evt_zzwrongamount1', 'type', 'checkout.session.completed',
    'session_id', sess, 'charge_id', c2, 'organization_id', org_a, 'amount', 1999, 'currency', 'usd', 'payment_status', 'paid', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'amount_mismatch' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' wrong amount refused');
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('event_id', 'evt_zzwrongcurrency', 'type', 'checkout.session.completed',
    'session_id', sess, 'charge_id', c2, 'organization_id', org_a, 'amount', 2000, 'currency', 'cad', 'payment_status', 'paid', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'amount_mismatch' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' wrong currency refused');
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('event_id', 'evt_zzotherorg0001', 'type', 'checkout.session.completed',
    'session_id', sess, 'charge_id', c2, 'organization_id', org_b, 'amount', 2000, 'currency', 'usd', 'payment_status', 'paid', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'unknown_charge' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' charge / organization mismatch in the metadata refused');
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('event_id', 'evt_zzunpaid00001', 'type', 'checkout.session.completed',
    'session_id', sess, 'charge_id', c2, 'organization_id', org_a, 'amount', 2000, 'currency', 'usd', 'payment_status', 'unpaid', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'not_paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' a completed session that is not paid yet changes nothing');
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN (SELECT status FROM public.billing_charges WHERE id = c2) = 'due'
      AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'billing.online_payment_amount_mismatch' AND target_id = org_a::text)
    THEN 'PASS' ELSE 'FAIL' END || ' after refused events the charge is still due; the mismatch is audited for staff');

  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('event_id', 'evt_zzgoodpayment1', 'type', 'checkout.session.completed',
    'session_id', sess, 'charge_id', c2, 'organization_id', org_a, 'amount', 2000, 'currency', 'usd', 'payment_status', 'paid',
    'payment_intent', 'pi_zz123', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' matching paid event marks the charge paid');
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('event_id', 'evt_zzgoodpayment1', 'type', 'checkout.session.completed',
    'session_id', sess, 'charge_id', c2, 'organization_id', org_a, 'amount', 2000, 'currency', 'usd', 'payment_status', 'paid', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'duplicate' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' the same event again is ignored (duplicate)');
  EXECUTE 'RESET ROLE';
  SELECT paid_at INTO paid_at_1 FROM public.billing_charges WHERE id = c2;
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('event_id', 'evt_zzasyncsucc001', 'type', 'checkout.session.async_payment_succeeded',
    'session_id', sess, 'charge_id', c2, 'organization_id', org_a, 'amount', 2000, 'currency', 'usd', 'payment_status', 'paid', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'already_paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' a second event for a paid charge is ignored (already_paid)');
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN (SELECT status = 'paid' AND payment_method = 'card' AND payment_provider = 'stripe' AND provider_session_id = sess
        AND payment_reference = 'pi_zz123' AND paid_amount = 2000 AND paid_at = paid_at_1 FROM public.billing_charges WHERE id = c2)
      AND (SELECT count(*) FROM public.billing_payment_events WHERE charge_id = c2) = 6
      AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'billing.charge_paid_online' AND target_id = org_a::text AND actor_id IS NULL)
    THEN 'PASS' ELSE 'FAIL' END || ' paid once: method card, session, amount recorded; every event kept; audited');

  -- Expired session: a new attempt, the previous session handed back to be expired.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.billing_checkout_record(c_ov, (public.billing_checkout_prepare(c_ov)->>'attempt')::int, 'cs_test_' || md5(c_ov::text));
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('event_id', 'evt_zzexpired00001', 'type', 'checkout.session.expired',
    'session_id', 'cs_test_' || md5(c_ov::text), 'charge_id', c_ov, 'organization_id', org_a, 'amount', 5000, 'currency', 'usd',
    'payment_status', 'unpaid', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'expired' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' checkout.session.expired recorded');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.billing_checkout_prepare(c_ov);
  results := results || (CASE WHEN (j->>'attempt')::int = 2 AND j->>'previous_session_id' = 'cs_test_' || md5(c_ov::text) AND j->>'session_id' IS NULL
    THEN 'PASS' ELSE 'FAIL ' || j::text END || ' after expiry the next checkout is a new attempt');
  BEGIN PERFORM public.billing_ingest_stripe_event(k, '{}'); results := results || 'FAIL signed-in user called the webhook function'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS signed-in users cannot call the webhook function'::text; END;
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN (SELECT status FROM public.billing_charges WHERE id = c_ov) = 'due' THEN 'PASS' ELSE 'FAIL' END || ' an expired session leaves the charge due');

  SELECT count(*) INTO failed FROM unnest(results) r WHERE r LIKE 'FAIL%';
  RAISE EXCEPTION E'% failed, % passed\n%', failed, cardinality(results) - failed, array_to_string(results, E'\n');
END;
$$;
