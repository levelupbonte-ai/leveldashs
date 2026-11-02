-- Client portal. Always rolls back (RAISE EXCEPTION at the end); the exception
-- message is the report and must show "0 failed".
--
-- Covers: customers created from paid payments, the portal key scope, sign-in
-- codes (unknown address, single use, replaced by a newer code, 5 wrong tries,
-- expiry, per-address rate limit), sessions (other website, sign out of all
-- devices, revoked customer), customer A never sees customer B, another
-- website's customers see nothing, an owner of another organization and a
-- viewer cannot manage, editors publish (one customer / an offer / everyone),
-- private documents (no listing, ticketed sign only, the ticket function
-- refuses others), messages (rate limit, owner reply), optional password
-- (fresh code, weak passwords, neutral failures), e-mail change with two codes,
-- the e-mail queue, the audit log.
DO $$
DECLARE
  u_a uuid := gen_random_uuid();   -- owner of org A
  u_e uuid := gen_random_uuid();   -- editor of org A
  u_v uuid := gen_random_uuid();   -- viewer of org A
  u_b uuid := gen_random_uuid();   -- owner of org B
  org_a uuid; org_b uuid; ws_a text; ws_b text;
  key_a text; key_pay text; key_b text;
  client text := repeat('ab', 16);
  j jsonb; n int; t text; r text[] := '{}';
  c_alice uuid; c_bob uuid; s_alice text; s_bob text; s_alice2 text; s_carol text;
  code1 text; code2 text;
  it_all uuid; it_alice uuid; it_bob uuid; it_solo uuid; it_duo uuid; it_doc uuid; it_list uuid;
  doc_path text; other_path text; pay_alice uuid;
BEGIN
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES
    (u_a, 'portal-a@example.invalid', 'authenticated', 'authenticated', now()),
    (u_e, 'portal-e@example.invalid', 'authenticated', 'authenticated', now()),
    (u_v, 'portal-v@example.invalid', 'authenticated', 'authenticated', now()),
    (u_b, 'portal-b@example.invalid', 'authenticated', 'authenticated', now());
  INSERT INTO public.organizations (name, slug) VALUES ('Portal A', 'portal-test-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('Portal B', 'portal-test-b') RETURNING id INTO org_b;
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
    (org_a, u_a, 'owner'), (org_a, u_e, 'editor'), (org_a, u_v, 'viewer'), (org_b, u_b, 'owner');
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'Portal site A', 'active') RETURNING id INTO ws_a;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_b, 'Portal site B', 'active') RETURNING id INTO ws_b;
  INSERT INTO public.website_features (website_id, organization_id, feature_key) VALUES
    (ws_a, org_a, 'client_portal'), (ws_a, org_a, 'payments'), (ws_b, org_b, 'client_portal');

  -- ---------- keys ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  key_a := public.site_create_api_key(ws_a, 'Portal', 'live', ARRAY['portal:access']) ->> 'key';
  key_pay := public.site_create_api_key(ws_a, 'Payments', 'live', ARRAY['payments:write']) ->> 'key';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  key_b := public.site_create_api_key(ws_b, 'Portal B', 'live', ARRAY['portal:access']) ->> 'key';
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN key_a ~ '^lu_live_' AND key_b ~ '^lu_live_' THEN 'PASS' ELSE 'FAIL' END || ' portal:access scope accepted');

  -- ---------- customers from paid payments ----------
  INSERT INTO public.site_payments (website_id, organization_id, provider, provider_event_id, provider_session_id,
      provider_payment_intent, status, amount, currency, offer_id, offer_name, customer_email, customer_name, occurred_at, paid_at)
  VALUES
    (ws_a, org_a, 'stripe', 'evt_pa1', 'cs_live_pa1', 'pi_pa1', 'paid', 260, 'usd', 'solo', 'Solo', 'Alice@Example.com', 'Alice', now(), now()),
    (ws_a, org_a, 'stripe', 'evt_pa2', 'cs_live_pa2', 'pi_pa2', 'pending', 500, 'usd', 'duo', 'Duo', 'bob@example.com', 'Bob', now(), null),
    (ws_b, org_b, 'stripe', 'evt_pb1', 'cs_live_pb1', 'pi_pb1', 'paid', 900, 'usd', 'x', 'X', 'carol@example.com', 'Carol', now(), now());
  SELECT count(*) INTO n FROM public.portal_customers WHERE website_id = ws_a;
  r := r || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL ' || n END || ' only the paid payment creates a customer');
  UPDATE public.site_payments SET status = 'paid', paid_at = now() WHERE provider_session_id = 'cs_live_pa2';
  SELECT id INTO c_alice FROM public.portal_customers WHERE website_id = ws_a AND email = 'alice@example.com';
  SELECT id INTO c_bob FROM public.portal_customers WHERE website_id = ws_a AND email = 'bob@example.com';
  SELECT id INTO pay_alice FROM public.site_payments WHERE provider_session_id = 'cs_live_pa1';
  r := r || (CASE WHEN c_alice IS NOT NULL AND c_bob IS NOT NULL THEN 'PASS' ELSE 'FAIL' END || ' pending -> paid creates the customer (lower-case e-mail)');
  SELECT count(*) INTO n FROM private.portal_outbox WHERE website_id = ws_a AND kind = 'access';
  r := r || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL ' || n END || ' access e-mails queued');
  UPDATE public.site_payments SET status = 'refunded' WHERE provider_session_id = 'cs_live_pa2';
  UPDATE public.site_payments SET status = 'paid' WHERE provider_session_id = 'cs_live_pa2';
  SELECT count(*) INTO n FROM public.portal_customers WHERE website_id = ws_a;
  r := r || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL ' || n END || ' no duplicate customer');

  -- ---------- table access ----------
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN SELECT count(*) INTO n FROM public.portal_customers; r := r || 'FAIL anon read portal_customers'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS anon cannot read customers'::text; END;
  BEGIN SELECT count(*) INTO n FROM public.portal_items; r := r || 'FAIL anon read portal_items'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS anon cannot read items'::text; END;
  BEGIN SELECT count(*) INTO n FROM private.portal_sessions; r := r || 'FAIL anon read sessions'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS anon cannot read sessions'::text; END;
  BEGIN PERFORM public.portal_admin_overview(ws_a); r := r || 'FAIL anon overview'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS anon cannot call admin functions'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.portal_customers;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' viewer sees no customers');
  BEGIN PERFORM public.portal_admin_overview(ws_a); r := r || 'FAIL viewer overview'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS viewer cannot manage'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.portal_customers WHERE website_id = ws_a;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' owner of org B sees no customer of A');
  BEGIN PERFORM public.portal_admin_overview(ws_a); r := r || 'FAIL owner B overview A'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS owner B cannot read A'::text; END;
  BEGIN PERFORM public.portal_admin_publish(ws_a, '{"kind":"update","audience":"all","title":"x"}'); r := r || 'FAIL owner B published on A'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS owner B cannot publish on A'::text; END;
  BEGIN PERFORM public.portal_admin_invite(ws_a, 'mallory@example.com'); r := r || 'FAIL owner B invited on A'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS owner B cannot invite on A'::text; END;
  BEGIN PERFORM public.portal_admin_thread(c_alice); r := r || 'FAIL owner B read thread'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS owner B cannot read A threads'::text; END;
  BEGIN PERFORM public.portal_admin_set_customer_status(c_alice, 'revoked'); r := r || 'FAIL owner B revoked'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS owner B cannot revoke A customers'::text; END;
  EXECUTE 'RESET ROLE';

  -- ---------- editor publishes ----------
  doc_path := 'org/' || org_a || '/site/' || ws_a || '/' || gen_random_uuid() || '.pdf';
  other_path := 'org/' || org_a || '/site/' || ws_a || '/' || gen_random_uuid() || '.pdf';
  INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES
    ('portal-documents', doc_path, u_e, '{"size": 1234, "mimetype": "application/pdf"}'),
    ('portal-documents', other_path, u_e, '{"size": 99, "mimetype": "application/pdf"}');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.portal_admin_overview(ws_a);
  r := r || (CASE WHEN jsonb_array_length(j -> 'customers') = 2 THEN 'PASS' ELSE 'FAIL ' || j::text END || ' editor lists the customers');
  it_all := (public.portal_admin_publish(ws_a, '{"kind":"update","audience":"all","title":"Welcome","body":"Hello all"}') ->> 'id')::uuid;
  it_alice := (public.portal_admin_publish(ws_a, jsonb_build_object('kind', 'update', 'audience', 'customer', 'customer_id', c_alice, 'title', 'For Alice')) ->> 'id')::uuid;
  it_bob := (public.portal_admin_publish(ws_a, jsonb_build_object('kind', 'update', 'audience', 'customer', 'customer_id', c_bob, 'title', 'For Bob')) ->> 'id')::uuid;
  it_solo := (public.portal_admin_publish(ws_a, jsonb_build_object('kind', 'trip', 'audience', 'offer', 'offer_id', 'solo', 'title', 'Solo trip',
      'trip', jsonb_build_object('start_date', '2026-12-01', 'meeting_point', 'Airport', 'steps', jsonb_build_array(jsonb_build_object('date', '2026-12-01', 'title', 'Arrival'))))) ->> 'id')::uuid;
  it_duo := (public.portal_admin_publish(ws_a, jsonb_build_object('kind', 'update', 'audience', 'offer', 'offer_id', 'duo', 'title', 'Duo only')) ->> 'id')::uuid;
  it_doc := (public.portal_admin_publish(ws_a, jsonb_build_object('kind', 'document', 'audience', 'customer', 'customer_id', c_alice, 'title', 'Visa letter', 'document_path', doc_path, 'document_name', 'visa.pdf')) ->> 'id')::uuid;
  it_list := (public.portal_admin_publish(ws_a, jsonb_build_object('kind', 'checklist', 'audience', 'all', 'title', 'What to bring', 'checklist', jsonb_build_array('Passport', 'Charger'))) ->> 'id')::uuid;
  r := r || (CASE WHEN it_doc IS NOT NULL AND it_list IS NOT NULL THEN 'PASS' ELSE 'FAIL' END || ' editor publishes updates, trip, document, checklist');
  BEGIN PERFORM public.portal_admin_publish(ws_a, '{"kind":"update","audience":"all","title":"<script>x</script>"}'); r := r || 'FAIL HTML title accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS HTML title rejected'::text; END;
  BEGIN PERFORM public.portal_admin_publish(ws_a, jsonb_build_object('kind', 'document', 'audience', 'all', 'title', 'x', 'document_path', 'org/' || org_b || '/site/' || ws_b || '/' || gen_random_uuid() || '.pdf')); r := r || 'FAIL foreign document path accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS document path of another site rejected'::text; END;
  BEGIN PERFORM public.portal_admin_publish(ws_a, jsonb_build_object('kind', 'document', 'audience', 'all', 'title', 'x', 'document_path', 'org/' || org_a || '/site/' || ws_a || '/' || gen_random_uuid() || '.pdf')); r := r || 'FAIL missing object accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS document must exist in storage'::text; END;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'portal-documents' AND name IN (doc_path, other_path);
  r := r || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL ' || n END || ' editor sees the documents of A');
  j := public.portal_admin_invite(ws_a, 'Dana@Example.com', 'Dana', 'duo');
  r := r || (CASE WHEN (j ->> 'created')::boolean THEN 'PASS' ELSE 'FAIL' END || ' editor invites by e-mail');
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM private.portal_outbox WHERE item_id = it_all;
  r := r || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL ' || n END || ' "everyone" update queued for both customers');
  SELECT count(*) INTO n FROM private.portal_outbox WHERE item_id = it_solo;
  r := r || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL ' || n END || ' offer update queued for the offer group only');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'portal-documents';
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' owner of org B sees no portal document');
  BEGIN INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('portal-documents', 'org/' || org_a || '/site/' || ws_a || '/' || gen_random_uuid() || '.pdf', u_b);
    r := r || 'FAIL owner B uploaded into A'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS owner B cannot upload into A'::text; END;
  EXECUTE 'RESET ROLE';

  -- ---------- sign-in codes (website server = anon + key) ----------
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM public.portal_request_code(key_pay, 'alice@example.com', client); r := r || 'FAIL key without portal scope accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN r := r || 'PASS key without portal scope -> 403'::text; END;
  BEGIN PERFORM public.portal_request_code('lu_live_' || repeat('0', 48), 'alice@example.com', client); r := r || 'FAIL unknown key accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS unknown key -> 401'::text; END;
  j := public.portal_request_code(key_a, 'nobody@example.com', client);
  r := r || (CASE WHEN j = '{"ok": true, "send": false}'::jsonb THEN 'PASS' ELSE 'FAIL ' || j::text END || ' unknown address: nothing to send');
  j := public.portal_request_code(key_a, 'carol@example.com', client);
  r := r || (CASE WHEN j = '{"ok": true, "send": false}'::jsonb THEN 'PASS' ELSE 'FAIL ' || j::text END || ' customer of another website: nothing to send');
  j := public.portal_request_code(key_a, ' Alice@Example.com ', client, 'fr');
  code1 := j ->> 'code';
  r := r || (CASE WHEN (j ->> 'send')::boolean AND code1 ~ '^[0-9]{6}$' AND j ->> 'email' = 'alice@example.com' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' customer gets a 6-digit code');
  code2 := public.portal_request_code(key_a, 'alice@example.com', client) ->> 'code';
  j := public.portal_verify_code(key_a, 'alice@example.com', code1, client);
  r := r || (CASE WHEN NOT (j ->> 'ok')::boolean OR code1 = code2 THEN 'PASS' ELSE 'FAIL' END || ' a newer code replaces the older one');
  j := public.portal_verify_code(key_a, 'alice@example.com', code2, client, 'Chrome on Android');
  s_alice := j ->> 'session';
  r := r || (CASE WHEN (j ->> 'ok')::boolean AND s_alice ~ '^[0-9a-f]{64}$' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' right code signs in');
  j := public.portal_verify_code(key_a, 'alice@example.com', code2, client);
  r := r || (CASE WHEN NOT (j ->> 'ok')::boolean THEN 'PASS' ELSE 'FAIL' END || ' a code works once');
  j := public.portal_verify_code(key_a, 'nobody@example.com', '123456', client);
  r := r || (CASE WHEN j = '{"ok": false, "reason": "invalid"}'::jsonb THEN 'PASS' ELSE 'FAIL ' || j::text END || ' unknown address: same answer as a wrong code');

  code1 := public.portal_request_code(key_a, 'bob@example.com', client) ->> 'code';
  FOR n IN 1..5 LOOP
    PERFORM public.portal_verify_code(key_a, 'bob@example.com', CASE WHEN code1 = '000000' THEN '111111' ELSE '000000' END, client);
  END LOOP;
  j := public.portal_verify_code(key_a, 'bob@example.com', code1, client);
  r := r || (CASE WHEN NOT (j ->> 'ok')::boolean THEN 'PASS' ELSE 'FAIL' END || ' 5 wrong tries kill the code');
  code1 := public.portal_request_code(key_a, 'bob@example.com', client) ->> 'code';
  EXECUTE 'RESET ROLE';
  UPDATE private.portal_codes SET expires_at = now() - interval '1 second' WHERE customer_id = c_bob AND used_at IS NULL;
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.portal_verify_code(key_a, 'bob@example.com', code1, client);
  r := r || (CASE WHEN NOT (j ->> 'ok')::boolean THEN 'PASS' ELSE 'FAIL' END || ' an expired code is refused');
  code1 := public.portal_request_code(key_a, 'bob@example.com', client) ->> 'code';
  s_bob := public.portal_verify_code(key_a, 'bob@example.com', code1, client) ->> 'session';
  PERFORM public.portal_request_code(key_a, 'bob@example.com', client);
  PERFORM public.portal_request_code(key_a, 'bob@example.com', client);
  BEGIN PERFORM public.portal_request_code(key_a, 'bob@example.com', client); r := r || 'FAIL 6th code in an hour accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT429' THEN r := r || 'PASS codes rate-limited per address (5/hour)'::text; END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM private.portal_codes c
  WHERE c.customer_id IN (c_alice, c_bob) AND (c.code_hash !~ '^[0-9a-f]{64}$');
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' codes stored as hashes only');
  SELECT count(*) INTO n FROM private.portal_sessions WHERE token_hash = s_alice;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' session tokens stored as hashes only');
  SELECT count(*) INTO n FROM private.portal_outbox WHERE customer_id = c_alice AND kind = 'signin' AND data ->> 'device' = 'Chrome on Android';
  r := r || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL ' || n END || ' new sign-in alert queued (device, time)');

  -- ---------- isolation between customers ----------
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.portal_home(key_a, s_alice);
  SELECT array_agg(x ->> 'title' ORDER BY x ->> 'title') INTO STRICT t FROM jsonb_array_elements(j -> 'items') x;
  r := r || (CASE WHEN t = '{"For Alice","Solo trip","Visa letter",Welcome,"What to bring"}' THEN 'PASS' ELSE 'FAIL ' || t END || ' Alice sees her items, her offer and everyone''s');
  r := r || (CASE WHEN jsonb_array_length(j -> 'bookings') = 1 AND j #>> '{bookings,0,offer_id}' = 'solo' AND (j #>> '{bookings,0,receipt}')::boolean
    THEN 'PASS' ELSE 'FAIL ' || (j -> 'bookings')::text END || ' Alice sees only her booking');
  j := public.portal_home(key_a, s_bob);
  SELECT array_agg(x ->> 'title' ORDER BY x ->> 'title') INTO STRICT t FROM jsonb_array_elements(j -> 'items') x;
  r := r || (CASE WHEN t = '{"Duo only","For Bob",Welcome,"What to bring"}' THEN 'PASS' ELSE 'FAIL ' || t END || ' Bob never sees Alice''s items');
  BEGIN PERFORM public.portal_mark_read(key_a, s_bob, it_alice); r := r || 'FAIL Bob marked Alice''s item'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN r := r || 'PASS Bob cannot touch Alice''s item'::text; END;
  BEGIN PERFORM public.portal_document_ticket(key_a, s_bob, it_doc); r := r || 'FAIL Bob got a ticket for Alice''s document'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN r := r || 'PASS document ticket refuses other customers'::text; END;
  BEGIN PERFORM public.portal_payment_reference(key_a, s_bob, pay_alice); r := r || 'FAIL Bob read Alice''s payment'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN r := r || 'PASS payment reference refuses other customers'::text; END;
  BEGIN PERFORM public.portal_home(key_b, s_alice); r := r || 'FAIL session used on another website'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS a session only works on its website'::text; END;
  BEGIN PERFORM public.portal_home(key_a, repeat('0', 64)); r := r || 'FAIL forged session'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS unknown session -> 401'::text; END;

  -- another website's customer
  code1 := public.portal_request_code(key_b, 'carol@example.com', client) ->> 'code';
  s_carol := public.portal_verify_code(key_b, 'carol@example.com', code1, client) ->> 'session';
  j := public.portal_home(key_b, s_carol);
  r := r || (CASE WHEN jsonb_array_length(j -> 'items') = 0 AND jsonb_array_length(j -> 'messages') = 0 THEN 'PASS' ELSE 'FAIL ' || j::text END || ' a customer of site B sees nothing of A');
  BEGIN PERFORM public.portal_home(key_a, s_carol); r := r || 'FAIL B session on A'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS a B session is refused on A'::text; END;

  -- ---------- documents: private bucket, ticketed sign only ----------
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'portal-documents';
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' anon lists no document');
  j := public.portal_document_ticket(key_a, s_alice, it_doc);
  r := r || (CASE WHEN j ->> 'path' = doc_path AND (j ->> 'expires_in')::int = 60 THEN 'PASS' ELSE 'FAIL ' || j::text END || ' Alice gets a 60-second ticket');
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'portal-documents';
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' an open ticket still allows no listing or download');
  PERFORM set_config('storage.operation', 'storage.object.sign', true);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'portal-documents' AND name = doc_path;
  r := r || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL ' || n END || ' sign allowed for the ticketed object');
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'portal-documents' AND name = other_path;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' sign refused for an object without ticket');
  PERFORM set_config('storage.operation', 'storage.object.list', true);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'portal-documents';
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' listing refused even with a ticket open');
  PERFORM set_config('storage.operation', '', true);
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN (SELECT NOT public FROM storage.buckets WHERE id = 'portal-documents') THEN 'PASS' ELSE 'FAIL' END || ' bucket is private');
  UPDATE private.portal_download_tickets SET expires_at = now() - interval '1 second';
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM set_config('storage.operation', 'storage.object.sign', true);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'portal-documents' AND name = doc_path;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' expired ticket: sign refused');
  PERFORM set_config('storage.operation', '', true);

  -- ---------- read state, checklist ----------
  PERFORM public.portal_mark_read(key_a, s_alice, it_all);
  j := public.portal_set_checklist(key_a, s_alice, it_list, 1, true);
  r := r || (CASE WHEN j -> 'checked' = '[1]'::jsonb THEN 'PASS' ELSE 'FAIL ' || j::text END || ' checklist item ticked');
  BEGIN PERFORM public.portal_set_checklist(key_a, s_alice, it_list, 9, true); r := r || 'FAIL out-of-range checklist index'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS checklist index checked'::text; END;
  j := public.portal_home(key_a, s_alice);
  SELECT count(*) INTO n FROM jsonb_array_elements(j -> 'items') x WHERE (x ->> 'read')::boolean;
  r := r || (CASE WHEN n = 3 THEN 'PASS' ELSE 'FAIL ' || n END || ' read state per item (read, ticked, downloaded)');
  j := public.portal_home(key_a, s_bob);
  SELECT count(*) INTO n FROM jsonb_array_elements(j -> 'items') x WHERE (x ->> 'read')::boolean;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' Alice''s reads do not mark Bob''s items');

  -- ---------- messages ----------
  PERFORM public.portal_send_message(key_a, s_alice, 'Hello, when do we leave?');
  BEGIN PERFORM public.portal_send_message(key_a, s_alice, '   '); r := r || 'FAIL empty message accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS empty message refused'::text; END;
  BEGIN PERFORM public.portal_send_message(key_a, s_alice, repeat('x', 4001)); r := r || 'FAIL long message accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS message over 4000 characters refused'::text; END;
  FOR n IN 2..10 LOOP PERFORM public.portal_send_message(key_a, s_alice, 'msg ' || n); END LOOP;
  BEGIN PERFORM public.portal_send_message(key_a, s_alice, 'one too many'); r := r || 'FAIL 11th message in an hour'::text;
  EXCEPTION WHEN SQLSTATE 'PT429' THEN r := r || 'PASS messages rate-limited (10/hour)'::text; END;
  j := public.portal_home(key_a, s_bob);
  r := r || (CASE WHEN jsonb_array_length(j -> 'messages') = 0 THEN 'PASS' ELSE 'FAIL' END || ' Bob never sees Alice''s messages');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.portal_admin_overview(ws_a);
  SELECT (x ->> 'unread')::int INTO n FROM jsonb_array_elements(j -> 'customers') x WHERE x ->> 'id' = c_alice::text;
  r := r || (CASE WHEN n = 10 THEN 'PASS' ELSE 'FAIL ' || n END || ' replies reach the business (10 unread)');
  j := public.portal_admin_thread(c_alice);
  PERFORM public.portal_admin_reply(c_alice, 'We leave on 1 December.');
  PERFORM public.portal_admin_set_customer_status(c_bob, 'revoked');
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.portal_home(key_a, s_alice);
  r := r || (CASE WHEN j #>> '{messages,-1,sender}' = 'owner' AND NOT (j #>> '{messages,-1,read}')::boolean THEN 'PASS' ELSE 'FAIL' END || ' owner reply reaches the customer, unread');
  BEGIN PERFORM public.portal_home(key_a, s_bob); r := r || 'FAIL revoked customer still signed in'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS revoking a customer ends the sessions'::text; END;
  j := public.portal_request_code(key_a, 'dana@example.com', repeat('cd', 16));
  r := r || (CASE WHEN (j ->> 'send')::boolean THEN 'PASS' ELSE 'FAIL' END || ' invited customer can sign in');

  -- ---------- password ----------
  j := public.portal_set_password(key_a, s_alice, '123456', 'a long enough password');
  r := r || (CASE WHEN j ->> 'reason' = 'invalid_code' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' setting a password needs a fresh code');
  code1 := public.portal_request_code(key_a, null, client, null, 'password', s_alice) ->> 'code';
  BEGIN PERFORM public.portal_set_password(key_a, s_alice, code1, 'short'); r := r || 'FAIL short password'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS password under 10 characters refused'::text; END;
  BEGIN PERFORM public.portal_set_password(key_a, s_alice, code1, 'aaaaaaaaaaaa'); r := r || 'FAIL repeated password'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS one repeated character refused'::text; END;
  code2 := public.portal_verify_code(key_a, 'alice@example.com', public.portal_request_code(key_a, 'alice@example.com', client) ->> 'code', client) ->> 'session';
  s_alice2 := code2;
  j := public.portal_set_password(key_a, s_alice, code1, 'correct horse battery');
  r := r || (CASE WHEN (j ->> 'ok')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' password set with the code');
  BEGIN PERFORM public.portal_home(key_a, s_alice2); r := r || 'FAIL other session kept after password change'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS password change signs out the other devices'::text; END;
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN (SELECT password_hash ~ '^\$2a\$12\$' FROM private.portal_passwords WHERE customer_id = c_alice) THEN 'PASS' ELSE 'FAIL' END || ' password stored as bcrypt');
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.portal_password_sign_in(key_a, 'alice@example.com', 'correct horse battery', client, 'Safari on iPhone');
  r := r || (CASE WHEN (j ->> 'ok')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' password sign-in');
  j := public.portal_password_sign_in(key_a, 'alice@example.com', 'wrong horse battery', client);
  r := r || (CASE WHEN j = '{"ok": false, "reason": "invalid"}'::jsonb THEN 'PASS' ELSE 'FAIL ' || j::text END || ' wrong password: neutral answer');
  j := public.portal_password_sign_in(key_a, 'nobody@example.com', 'wrong horse battery', client);
  r := r || (CASE WHEN j = '{"ok": false, "reason": "invalid"}'::jsonb THEN 'PASS' ELSE 'FAIL ' || j::text END || ' unknown address: same answer');

  -- ---------- e-mail change (codes to both addresses) ----------
  j := public.portal_email_change_start(key_a, s_alice, 'bob@example.com', client);
  r := r || (CASE WHEN j ->> 'reason' = 'unavailable' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' cannot take another customer''s address');
  j := public.portal_email_change_start(key_a, s_alice, 'alice.new@example.com', client);
  r := r || (CASE WHEN j #>> '{old,email}' = 'alice@example.com' AND j #>> '{new,email}' = 'alice.new@example.com' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' codes for the old and the new address');
  t := public.portal_email_change_confirm(key_a, s_alice, j #>> '{old,code}', CASE WHEN j #>> '{new,code}' = '000000' THEN '111111' ELSE '000000' END) ->> 'ok';
  r := r || (CASE WHEN t = 'false' THEN 'PASS' ELSE 'FAIL' END || ' one wrong code: no change');
  j := public.portal_email_change_start(key_a, s_alice, 'alice.new@example.com', client);
  t := public.portal_email_change_confirm(key_a, s_alice, j #>> '{old,code}', j #>> '{new,code}') ->> 'email';
  r := r || (CASE WHEN t = 'alice.new@example.com' THEN 'PASS' ELSE 'FAIL ' || coalesce(t, 'null') END || ' both codes change the address');
  j := public.portal_home(key_a, s_alice);
  r := r || (CASE WHEN jsonb_array_length(j -> 'bookings') = 1 THEN 'PASS' ELSE 'FAIL' END || ' payments stay linked after the change');

  -- ---------- sign out of all devices ----------
  PERFORM public.portal_sign_out(key_a, s_alice, true);
  BEGIN PERFORM public.portal_home(key_a, s_alice); r := r || 'FAIL session kept after sign out'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS sign out of all devices'::text; END;

  -- ---------- e-mail queue ----------
  BEGIN PERFORM public.portal_outbox_claim(key_pay); r := r || 'FAIL queue read without portal scope'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN r := r || 'PASS queue needs the portal key'::text; END;
  j := public.portal_outbox_claim(key_b, 25);
  r := r || (CASE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j) x WHERE x ->> 'to' LIKE '%alice%') THEN 'PASS' ELSE 'FAIL' END || ' site B key never sees A''s queue');
  j := public.portal_outbox_claim(key_a, 25);
  r := r || (CASE WHEN jsonb_array_length(j) > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j) x WHERE x ->> 'to' = 'bob@example.com')
    THEN 'PASS' ELSE 'FAIL ' || jsonb_array_length(j) END || ' queue claimed, revoked customer skipped');
  j := public.portal_outbox_complete(key_a, (j -> 0 ->> 'id')::bigint, true);
  r := r || (CASE WHEN (j ->> 'ok')::boolean THEN 'PASS' ELSE 'FAIL' END || ' e-mail marked sent');
  EXECUTE 'RESET ROLE';

  -- ---------- audit ----------
  SELECT count(*) INTO n FROM public.site_audit_log WHERE website_id = ws_a AND action LIKE 'portal.%';
  r := r || (CASE WHEN n = 10 THEN 'PASS' ELSE 'FAIL ' || n END || ' owner actions audited (7 published, 1 invite, 1 reply, 1 revoke)');

  RAISE EXCEPTION E'CLIENT PORTAL TESTS (rolled back): % failed\n%',
    (SELECT count(*) FROM unnest(r) x WHERE x LIKE 'FAIL%'), array_to_string(r, E'\n');
END $$;
