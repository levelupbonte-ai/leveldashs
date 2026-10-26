-- Site server keys + payment ingestion + payments reads. Always rolls back
-- (RAISE EXCEPTION at the end); the exception message is the report and must
-- show "0 failed".
--
-- Covers: key creation (admin only, shown once, hash stored), bad / revoked
-- key, wrong scope, strict event validation, duplicate event, idempotent
-- status upgrade (pending -> paid, never paid -> pending), refunds, RLS
-- isolation between organizations, customer details masked for viewers,
-- export reserved to admins, audit log.
DO $$
DECLARE
  u_a uuid := gen_random_uuid();   -- owner of org A
  u_e uuid := gen_random_uuid();   -- editor of org A
  u_v uuid := gen_random_uuid();   -- viewer of org A
  u_b uuid := gen_random_uuid();   -- owner of org B
  org_a uuid; org_b uuid; ws_a text; ws_b text;
  key_live text; key_test text; key_events text; key_id uuid; key_b text;
  j jsonb; n int; t text; r text[] := '{}';
  ev jsonb;
BEGIN
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES
    (u_a, 'pay-a@example.invalid', 'authenticated', 'authenticated', now()),
    (u_e, 'pay-e@example.invalid', 'authenticated', 'authenticated', now()),
    (u_v, 'pay-v@example.invalid', 'authenticated', 'authenticated', now()),
    (u_b, 'pay-b@example.invalid', 'authenticated', 'authenticated', now());
  INSERT INTO public.organizations (name, slug) VALUES ('Pay A', 'pay-test-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('Pay B', 'pay-test-b') RETURNING id INTO org_b;
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
    (org_a, u_a, 'owner'), (org_a, u_e, 'editor'), (org_a, u_v, 'viewer'), (org_b, u_b, 'owner');
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'Pay site A', 'active') RETURNING id INTO ws_a;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_b, 'Pay site B', 'active') RETURNING id INTO ws_b;
  INSERT INTO public.website_features (website_id, organization_id, feature_key) VALUES (ws_a, org_a, 'payments');

  -- ---------- keys ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.site_create_api_key(ws_a, 'Editor key'); r := r || 'FAIL editor created a key'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS editor cannot create keys'::text; END;
  SELECT count(*) INTO n FROM public.site_api_keys;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' editor cannot list keys');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.site_create_api_key(ws_a, 'Black Pater server', 'live', ARRAY['payments:write']);
  key_live := j->>'key'; key_id := (j->>'id')::uuid;
  r := r || (CASE WHEN key_live ~ '^lu_live_[0-9a-f]{48}$' AND j->>'key_hint' = right(key_live, 4) THEN 'PASS' ELSE 'FAIL ' || j::text END || ' owner creates a live key, shown once');
  key_test := public.site_create_api_key(ws_a, 'Staging', 'test') ->> 'key';
  key_events := public.site_create_api_key(ws_a, 'Events only', 'live', ARRAY['events:write']) ->> 'key';
  BEGIN PERFORM public.site_create_api_key(ws_a, 'Bad scope', 'live', ARRAY['admin:all']); r := r || 'FAIL unknown scope accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS unknown scope rejected'::text; END;
  BEGIN PERFORM public.site_create_api_key(ws_a, '<script>x</script>'); r := r || 'FAIL HTML key name accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS HTML key name rejected'::text; END;
  BEGIN PERFORM public.site_create_api_key(ws_b, 'Other org'); r := r || 'FAIL key created for another org'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS cannot create a key for another org'::text; END;
  SELECT count(*) INTO n FROM public.site_api_keys WHERE website_id = ws_a;
  r := r || (CASE WHEN n = 3 THEN 'PASS' ELSE 'FAIL ' || n END || ' owner lists the 3 keys');
  BEGIN SELECT key_hash INTO t FROM public.site_api_keys LIMIT 1; r := r || 'FAIL key hash readable'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS key hash not readable'::text; END;
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN (SELECT key_hash FROM public.site_api_keys WHERE id = key_id) = encode(extensions.digest(key_live, 'sha256'), 'hex')
    AND NOT EXISTS (SELECT 1 FROM public.site_api_keys WHERE key_hash LIKE '%' || right(key_live, 20) || '%')
    THEN 'PASS' ELSE 'FAIL' END || ' only the sha256 is stored');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  key_b := public.site_create_api_key(ws_b, 'B server') ->> 'key';
  EXECUTE 'RESET ROLE';

  -- ---------- ingestion (anon, like the website server) ----------
  ev := jsonb_build_object('provider', 'stripe', 'provider_event_id', 'evt_1', 'provider_session_id', 'cs_live_abc',
    'provider_payment_intent', null, 'status', 'pending', 'amount', 260, 'currency', 'usd',
    'offer_id', 'accompagnement-voyage', 'offer_name', 'Accompagnement voyage',
    'customer_email', 'Jane.Doe@Example.com', 'customer_name', 'Jane Doe',
    'occurred_at', '2026-10-20T14:00:00Z', 'metadata', jsonb_build_object('lang', 'fr'));

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM public.site_ingest_payment('lu_live_' || repeat('0', 48), ev); r := r || 'FAIL unknown key accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS unknown key -> 401'::text; END;
  BEGIN PERFORM public.site_ingest_payment('not-a-key', ev); r := r || 'FAIL malformed key accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS malformed key -> 401'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_events, ev); r := r || 'FAIL wrong scope accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN r := r || 'PASS key without payments:write -> 403'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_live, ev || '{"amount": 2.5}'); r := r || 'FAIL decimal amount accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS decimal amount rejected'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_live, ev || '{"amount": "260"}'); r := r || 'FAIL string amount accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS string amount rejected'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_live, ev - 'amount'); r := r || 'FAIL missing amount accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS missing amount rejected'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_live, ev || '{"status": "succeeded"}'); r := r || 'FAIL unknown status accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS unknown status rejected'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_live, ev || '{"currency": "USD"}'); r := r || 'FAIL uppercase currency accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS uppercase currency rejected'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_live, ev || '{"customer_email": "not-an-email"}'); r := r || 'FAIL bad email accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS bad email rejected'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_live, ev || '{"customer_name": "<img src=x onerror=alert(1)>"}'); r := r || 'FAIL HTML name accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS HTML customer name rejected'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_live, ev || '{"is_admin": true}'); r := r || 'FAIL unknown field accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS unknown field rejected'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_live, ev || '{"occurred_at": "yesterday"}'); r := r || 'FAIL bad date accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS bad occurred_at rejected'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_live, ev || jsonb_build_object('metadata', jsonb_build_object('blob', repeat('x', 9000)))); r := r || 'FAIL 9 KB metadata accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS metadata over 8 KB rejected'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_live, ev || '{"provider_session_id": "cs_test_abc"}'); r := r || 'FAIL test session with live key accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS test session refused on a live key'::text; END;

  j := public.site_ingest_payment(key_live, ev);
  r := r || (CASE WHEN (j->>'ok')::boolean AND (j->>'applied')::boolean AND j->>'status' = 'pending' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' pending payment recorded');
  j := public.site_ingest_payment(key_live, ev);
  r := r || (CASE WHEN (j->>'duplicate')::boolean AND NOT (j->>'applied')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' duplicate event ignored');
  j := public.site_ingest_payment(key_live, ev || '{"provider_event_id": "evt_2", "status": "paid", "provider_payment_intent": "pi_123", "occurred_at": "2026-10-20T14:01:00Z"}');
  r := r || (CASE WHEN (j->>'applied')::boolean AND j->>'status' = 'paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' pending -> paid upgrade');
  j := public.site_ingest_payment(key_live, ev || '{"provider_event_id": "evt_3", "status": "pending", "occurred_at": "2026-10-20T14:02:00Z"}');
  r := r || (CASE WHEN NOT (j->>'applied')::boolean AND j->>'status' = 'paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' paid never goes back to pending');
  j := public.site_ingest_payment(key_live, ev || '{"provider_event_id": "evt_4", "status": "failed"}');
  r := r || (CASE WHEN NOT (j->>'applied')::boolean AND j->>'status' = 'paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' paid never goes back to failed');
  j := public.site_ingest_payment(key_live, ev || '{"provider_event_id": "evt_5", "provider_session_id": "cs_live_def", "status": "paid", "amount": 9900, "customer_email": null, "customer_name": null}');
  j := public.site_ingest_payment(key_live, ev || '{"provider_event_id": "evt_6", "provider_session_id": "cs_live_def", "status": "refunded", "occurred_at": "2026-10-21T10:00:00Z", "customer_email": null, "customer_name": null}');
  r := r || (CASE WHEN j->>'status' = 'refunded' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' paid -> refunded');
  j := public.site_ingest_payment(key_test, ev || '{"provider_event_id": "evt_7", "provider_session_id": "cs_test_xyz", "status": "paid"}');
  r := r || (CASE WHEN (j->>'applied')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' test key records a test payment');
  j := public.site_ingest_payment(key_b, ev || '{"provider_event_id": "evt_1", "provider_session_id": "cs_live_b1", "status": "paid", "amount": 50000, "currency": "eur"}');
  r := r || (CASE WHEN (j->>'applied')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' same event id on another website is independent');
  BEGIN SELECT count(*) INTO n FROM public.site_payments; r := r || 'FAIL anon reads payments'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS anon cannot read payments'::text; END;
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO n FROM public.site_payments WHERE website_id = ws_a;
  r := r || (CASE WHEN n = 3 THEN 'PASS' ELSE 'FAIL ' || n END || ' 3 payments on site A');
  r := r || (CASE WHEN (SELECT customer_email = 'jane.doe@example.com' AND provider_payment_intent = 'pi_123' AND paid_at IS NOT NULL
                        FROM public.site_payments WHERE provider_session_id = 'cs_live_abc') THEN 'PASS' ELSE 'FAIL' END || ' email lowercased, intent kept, paid_at set');
  r := r || (CASE WHEN (SELECT NOT livemode FROM public.site_payments WHERE provider_session_id = 'cs_test_xyz') THEN 'PASS' ELSE 'FAIL' END || ' test payment flagged livemode=false');
  SELECT count(*) INTO n FROM public.site_payment_events WHERE website_id = ws_a;
  r := r || (CASE WHEN n = 7 THEN 'PASS' ELSE 'FAIL ' || n END || ' 7 events logged (duplicate not logged twice)');
  r := r || (CASE WHEN (SELECT last_used_at IS NOT NULL FROM public.site_api_keys WHERE id = key_id) THEN 'PASS' ELSE 'FAIL' END || ' last_used_at updated');

  -- ---------- reads ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.site_payments_list(ws_a);
  r := r || (CASE WHEN (j->>'total')::int = 2 AND NOT (j->>'pii')::boolean
    AND (SELECT bool_and(x->>'customer_email' IS NULL OR x->>'customer_email' LIKE 'j***@e***.com') FROM jsonb_array_elements(j->'rows') x)
    AND j::text NOT ILIKE '%jane.doe%' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' viewer sees 2 live payments, customer masked');
  BEGIN SELECT customer_email INTO t FROM public.site_payments LIMIT 1; r := r || 'FAIL viewer reads raw email'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS customer columns closed to direct reads'::text; END;
  j := public.site_payments_list(ws_a, 'jane');
  r := r || (CASE WHEN (j->>'total')::int = 0 THEN 'PASS' ELSE 'FAIL ' || j::text END || ' viewer cannot search by customer');
  BEGIN PERFORM public.site_payments_export(ws_a); r := r || 'FAIL viewer exported'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS viewer cannot export'::text; END;
  j := public.site_payments_summary(ws_a, 3650);
  r := r || (CASE WHEN j->'currencies'->0->>'currency' = 'usd' AND (j->'currencies'->0->>'paid_count')::int = 2
    AND (j->'currencies'->0->>'refund_count')::int = 1 AND (j->>'test_count')::int = 1 THEN 'PASS' ELSE 'FAIL ' || j::text END || ' summary: 2 paid, 1 refund, test excluded');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.site_payments_list(ws_a, 'jane', NULL, NULL, NULL, true, 'amount', false);
  r := r || (CASE WHEN (j->>'total')::int = 1 AND j->'rows'->0->>'customer_email' = 'jane.doe@example.com' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' editor searches and sees customer');
  j := public.site_payment_detail((j->'rows'->0->>'id')::uuid);
  r := r || (CASE WHEN jsonb_array_length(j->'events') = 4 AND j->'metadata'->>'lang' = 'fr' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' detail with events + metadata');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.site_payments WHERE website_id = ws_a;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' org B sees no payment of org A (RLS)');
  BEGIN PERFORM public.site_payments_list(ws_a); r := r || 'FAIL org B listed org A'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS org B cannot list org A'::text; END;
  SELECT count(*) INTO n FROM public.site_payment_events WHERE website_id = ws_a;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' org B sees no payment event of org A');
  r := r || (CASE WHEN (public.site_payments_summary(ws_a, 3650) -> 'currencies') = '[]'::jsonb THEN 'PASS' ELSE 'FAIL' END || ' org B summary of org A is empty');
  BEGIN PERFORM public.site_revoke_api_key(key_id); r := r || 'FAIL org B revoked a key of org A'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS org B cannot revoke a key of org A'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.site_payments_export(ws_a);
  r := r || (CASE WHEN jsonb_array_length(j) = 2 AND j::text ILIKE '%jane.doe@example.com%' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' owner exports with customer details');
  PERFORM public.site_revoke_api_key(key_id);
  SELECT count(*) INTO n FROM public.site_audit_log WHERE website_id = ws_a;
  r := r || (CASE WHEN n = 5 THEN 'PASS' ELSE 'FAIL ' || n END || ' audit: 3 created, 1 export, 1 revoked');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM public.site_ingest_payment(key_live, ev || '{"provider_event_id": "evt_9"}'); r := r || 'FAIL revoked key accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS revoked key -> 401'::text; END;
  BEGIN PERFORM public.site_create_api_key(ws_a, 'anon'); r := r || 'FAIL anon created a key'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS anon cannot create keys'::text; END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION E'SITE PAYMENTS TESTS (rolled back): % failed\n%',
    (SELECT count(*) FROM unnest(r) x WHERE x LIKE 'FAIL%'), array_to_string(r, E'\n');
END $$;
