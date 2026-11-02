-- Provider-neutral payment ingestion (migration 20261031100000). Always rolls
-- back (RAISE EXCEPTION at the end); the exception message is the report and
-- must show "0 failed".
--
-- Covers: every allow-listed provider slug accepted, unknown slugs refused,
-- zero-decimal currencies (XOF, XAF, JPY, KRW) stored as sent, uppercase
-- currency normalised, the former Stripe field names as aliases (and an alias
-- with its field refused), customer {} / offer {}, method default and
-- allow-list, cancelled status, idempotency per website + provider + payment
-- id and per provider + event id, paid never back to pending, test / live,
-- provider / method filters and summary, isolation between organizations,
-- bad / revoked / wrong-scope keys.
DO $$
DECLARE
  u_a uuid := gen_random_uuid();   -- owner of org A
  u_b uuid := gen_random_uuid();   -- owner of org B
  org_a uuid; org_b uuid; ws_a text; ws_b text;
  key_a text; key_test text; key_events text; key_b text; key_a_id uuid;
  providers text[] := private.site_payment_providers();
  p text; i int := 0; j jsonb; n int; r text[] := '{}';
  base jsonb;
BEGIN
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES
    (u_a, 'prov-a@example.invalid', 'authenticated', 'authenticated', now()),
    (u_b, 'prov-b@example.invalid', 'authenticated', 'authenticated', now());
  INSERT INTO public.organizations (name, slug) VALUES ('Prov A', 'prov-test-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('Prov B', 'prov-test-b') RETURNING id INTO org_b;
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
    (org_a, u_a, 'owner'), (org_b, u_b, 'owner');
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'Prov site A', 'active') RETURNING id INTO ws_a;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_b, 'Prov site B', 'active') RETURNING id INTO ws_b;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.site_create_api_key(ws_a, 'Server', 'live', ARRAY['payments:write']);
  key_a := j->>'key'; key_a_id := (j->>'id')::uuid;
  key_test := public.site_create_api_key(ws_a, 'Staging', 'test') ->> 'key';
  key_events := public.site_create_api_key(ws_a, 'Events only', 'live', ARRAY['events:write']) ->> 'key';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  key_b := public.site_create_api_key(ws_b, 'B server') ->> 'key';
  EXECUTE 'RESET ROLE';

  base := jsonb_build_object('provider', 'paystack', 'provider_event_id', 'ev-1',
    'provider_payment_id', 'T-1001', 'status', 'paid', 'amount', 500000, 'currency', 'NGN',
    'occurred_at', '2026-10-20T14:00:00Z');

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';

  -- ---------- keys ----------
  BEGIN PERFORM public.site_ingest_payment('lu_live_' || repeat('a', 48), base); r := r || 'FAIL unknown key accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS unknown key -> 401'::text; END;
  BEGIN PERFORM public.site_ingest_payment('sk_live_123', base); r := r || 'FAIL malformed key accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS malformed key -> 401'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_events, base); r := r || 'FAIL wrong scope accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN r := r || 'PASS key without payments:write -> 403'::text; END;

  -- ---------- every provider slug ----------
  FOREACH p IN ARRAY providers LOOP
    i := i + 1;
    BEGIN
      j := public.site_ingest_payment(key_a, jsonb_build_object('provider', p,
        'provider_event_id', CASE WHEN p = 'stripe' THEN 'evt_all' || i ELSE 'all-' || i END,
        'provider_payment_id', CASE WHEN p = 'stripe' THEN 'pi_all' || i ELSE 'pay-' || i END,
        'status', 'pending', 'amount', 1000, 'currency', 'usd', 'occurred_at', '2026-10-01T10:00:00Z'));
      IF NOT (j->>'applied')::boolean THEN r := r || ('FAIL provider ' || p || ' not applied'); END IF;
    EXCEPTION WHEN OTHERS THEN r := r || ('FAIL provider ' || p || ' refused: ' || SQLERRM);
    END;
  END LOOP;
  r := r || (CASE WHEN cardinality(providers) >= 20 THEN 'PASS' ELSE 'FAIL' END || ' ' || cardinality(providers) || ' provider slugs tried');

  FOREACH p IN ARRAY ARRAY['venmo', 'Stripe', 'PAYPAL', 'stripe ', '', 'pay-pal', 'other;drop'] LOOP
    BEGIN PERFORM public.site_ingest_payment(key_a, base || jsonb_build_object('provider', p));
      r := r || ('FAIL provider "' || p || '" accepted');
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
  END LOOP;
  r := r || 'PASS unknown / non-lowercase provider slugs refused'::text;
  BEGIN PERFORM public.site_ingest_payment(key_a, base - 'provider'); r := r || 'FAIL missing provider accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS missing provider refused'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"provider": 1}'); r := r || 'FAIL numeric provider accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS numeric provider refused'::text; END;

  -- ---------- strict rules kept ----------
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"provider_event_id": "<script>"}'); r := r || 'FAIL HTML event id accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS event id charset enforced'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || jsonb_build_object('provider_payment_id', repeat('x', 300))); r := r || 'FAIL 300-char payment id accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS payment id over 255 refused'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"provider": "stripe", "provider_event_id": "ev-1", "provider_payment_id": "cs_live_1"}'); r := r || 'FAIL stripe event without evt_ accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS stripe keeps evt_ event ids'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"amount": 5000.5}'); r := r || 'FAIL decimal amount accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS decimal amount refused (minor units only)'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"currency": "CFA"}' || '{"currency": "XO"}'); r := r || 'FAIL 2-letter currency accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS 2-letter currency refused'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"status": "succeeded"}'); r := r || 'FAIL unknown status accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS unknown status refused'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"method": "crypto"}'); r := r || 'FAIL unknown method accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS unknown method refused'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"customer": {"email": "a@b.co", "phone": "+2250700000000"}}'); r := r || 'FAIL unknown customer field accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS unknown customer.* field refused'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"customer": {"name": "<b>x</b>"}}'); r := r || 'FAIL HTML customer.name accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS HTML customer.name refused'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"offer": "plan"}'); r := r || 'FAIL string offer accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS offer must be an object'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"livemode": false}'); r := r || 'FAIL test payment on live key accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS livemode:false refused on a live key'::text; END;

  -- ---------- aliases ----------
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"provider_session_id": "T-1001"}'); r := r || 'FAIL field + alias accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS provider_payment_id + provider_session_id refused'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"provider_reference": "a", "provider_payment_intent": "a"}'); r := r || 'FAIL reference + alias accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS provider_reference + provider_payment_intent refused'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"customer": {"name": "A"}, "customer_name": "A"}'); r := r || 'FAIL customer + customer_name accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS customer + customer_name refused'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"offer": {"id": "a"}, "offer_id": "a"}'); r := r || 'FAIL offer + offer_id accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS offer + offer_id refused'::text; END;

  -- New names.
  j := public.site_ingest_payment(key_a, base || '{"provider_reference": "ref_abc", "method": "card",
    "customer": {"email": "Ama@Example.com", "name": "Ama Owusu"}, "offer": {"id": "box-1", "name": "Box"}}');
  r := r || (CASE WHEN (j->>'applied')::boolean AND j->>'status' = 'paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' generic names recorded');
  -- Former names on another provider (flutterwave), transaction id alias.
  j := public.site_ingest_payment(key_a, jsonb_build_object('provider', 'flutterwave', 'provider_event_id', '987654',
    'provider_transaction_id', '4123456', 'provider_payment_intent', 'FLW-REF-1', 'status', 'pending',
    'amount', 25000, 'currency', 'XOF', 'customer_email', 'kofi@example.com', 'customer_name', 'Kofi',
    'offer_id', 'box-2', 'offer_name', 'Big box', 'occurred_at', '2026-10-20T15:00:00Z'));
  r := r || (CASE WHEN (j->>'applied')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' former names (aliases) recorded');
  -- Former Stripe event, unchanged, still works.
  j := public.site_ingest_payment(key_a, jsonb_build_object('provider', 'stripe', 'provider_event_id', 'evt_old1',
    'provider_session_id', 'cs_live_old1', 'provider_payment_intent', 'pi_old1', 'status', 'paid',
    'amount', 26000, 'currency', 'usd', 'offer_id', 'travel', 'offer_name', 'Travel',
    'customer_email', 'jane@example.com', 'customer_name', 'Jane Doe',
    'occurred_at', '2026-10-20T14:00:00Z', 'metadata', '{}'::jsonb));
  r := r || (CASE WHEN (j->>'applied')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' former Stripe contract still accepted');

  -- ---------- zero-decimal currencies ----------
  j := public.site_ingest_payment(key_a, jsonb_build_object('provider', 'cinetpay', 'provider_event_id', 'cp-1',
    'provider_payment_id', 'CP-TX-1', 'status', 'paid', 'amount', 15000, 'currency', 'XOF',
    'occurred_at', '2026-10-21T09:00:00Z'));
  j := public.site_ingest_payment(key_a, jsonb_build_object('provider', 'fedapay', 'provider_event_id', 'fp-1',
    'provider_payment_id', 'FP-1', 'status', 'paid', 'amount', 7500, 'currency', 'xaf',
    'occurred_at', '2026-10-21T09:00:00Z'));
  j := public.site_ingest_payment(key_a, jsonb_build_object('provider', 'square', 'provider_event_id', 'sq-1',
    'provider_payment_id', 'SQ-1', 'status', 'paid', 'amount', 1200, 'currency', 'JPY',
    'occurred_at', '2026-10-21T09:00:00Z'));
  j := public.site_ingest_payment(key_a, jsonb_build_object('provider', 'other', 'provider_event_id', 'kr-1',
    'provider_payment_id', 'KR-1', 'status', 'paid', 'amount', 39000, 'currency', 'KRW',
    'occurred_at', '2026-10-21T09:00:00Z'));
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN (SELECT amount = 15000 AND currency = 'xof' FROM public.site_payments WHERE website_id = ws_a AND provider_session_id = 'CP-TX-1')
    AND (SELECT amount = 7500 AND currency = 'xaf' FROM public.site_payments WHERE website_id = ws_a AND provider_session_id = 'FP-1')
    AND (SELECT amount = 1200 AND currency = 'jpy' FROM public.site_payments WHERE website_id = ws_a AND provider_session_id = 'SQ-1')
    AND (SELECT amount = 39000 AND currency = 'krw' FROM public.site_payments WHERE website_id = ws_a AND provider_session_id = 'KR-1')
    THEN 'PASS' ELSE 'FAIL' END || ' zero-decimal amounts stored as sent, currency lowercased');
  r := r || (CASE WHEN (SELECT provider_payment_intent = 'ref_abc' AND method = 'card' AND customer_email = 'ama@example.com'
      AND customer_name = 'Ama Owusu' AND offer_id = 'box-1' AND offer_name = 'Box'
    FROM public.site_payments WHERE website_id = ws_a AND provider = 'paystack' AND provider_session_id = 'T-1001')
    THEN 'PASS' ELSE 'FAIL' END || ' customer {} / offer {} / provider_reference stored');
  r := r || (CASE WHEN (SELECT provider_payment_intent = 'FLW-REF-1' AND customer_email = 'kofi@example.com' AND offer_name = 'Big box'
      AND method IS NULL
    FROM public.site_payments WHERE website_id = ws_a AND provider = 'flutterwave' AND provider_session_id = '4123456')
    THEN 'PASS' ELSE 'FAIL' END || ' aliases stored in the same columns');
  r := r || (CASE WHEN (SELECT method FROM public.site_payments WHERE website_id = ws_a AND provider = 'mtn_momo') = 'mobile_money'
    AND (SELECT method FROM public.site_payments WHERE website_id = ws_a AND provider = 'cash_on_delivery') = 'cash'
    AND (SELECT method FROM public.site_payments WHERE website_id = ws_a AND provider = 'paypal') = 'paypal'
    THEN 'PASS' ELSE 'FAIL' END || ' method inferred for mobile money / cash / PayPal');
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';

  -- ---------- idempotency across providers ----------
  j := public.site_ingest_payment(key_a, base);
  r := r || (CASE WHEN (j->>'duplicate')::boolean AND NOT (j->>'applied')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' same provider + event id -> duplicate');
  j := public.site_ingest_payment(key_a, base || '{"provider": "flutterwave"}');
  r := r || (CASE WHEN (j->>'applied')::boolean AND NOT (j->>'duplicate')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' same ids at another provider -> another payment');
  j := public.site_ingest_payment(key_a, base || '{"provider_event_id": "ev-2", "status": "pending", "occurred_at": "2026-10-20T14:05:00Z"}');
  r := r || (CASE WHEN NOT (j->>'applied')::boolean AND j->>'status' = 'paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' paid never goes back to pending (paystack)');
  j := public.site_ingest_payment(key_a, base || '{"provider_event_id": "ev-3", "status": "cancelled"}');
  r := r || (CASE WHEN NOT (j->>'applied')::boolean AND j->>'status' = 'paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' paid never goes to cancelled');
  j := public.site_ingest_payment(key_a, base || '{"provider_event_id": "ev-4", "status": "refunded", "occurred_at": "2026-10-22T10:00:00Z"}');
  r := r || (CASE WHEN (j->>'applied')::boolean AND j->>'status' = 'refunded' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' paid -> refunded');
  j := public.site_ingest_payment(key_a, jsonb_build_object('provider', 'orange_money', 'provider_event_id', 'om-1',
    'provider_payment_id', 'OM-1', 'status', 'pending', 'amount', 2000, 'currency', 'xof', 'occurred_at', '2026-10-21T09:00:00Z'));
  j := public.site_ingest_payment(key_a, jsonb_build_object('provider', 'orange_money', 'provider_event_id', 'om-2',
    'provider_payment_id', 'OM-1', 'status', 'cancelled', 'amount', 2000, 'currency', 'xof', 'occurred_at', '2026-10-21T09:05:00Z'));
  r := r || (CASE WHEN (j->>'applied')::boolean AND j->>'status' = 'cancelled' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' pending -> cancelled');
  j := public.site_ingest_payment(key_a, jsonb_build_object('provider', 'orange_money', 'provider_event_id', 'om-3',
    'provider_payment_id', 'OM-1', 'status', 'paid', 'amount', 2000, 'currency', 'xof', 'occurred_at', '2026-10-21T09:10:00Z'));
  r := r || (CASE WHEN NOT (j->>'applied')::boolean AND j->>'status' = 'cancelled' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' cancelled is final');
  j := public.site_ingest_payment(key_test, base || '{"provider_event_id": "ev-test", "provider_payment_id": "T-test"}');
  r := r || (CASE WHEN (j->>'applied')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' test key records a test payment');
  j := public.site_ingest_payment(key_b, base);
  r := r || (CASE WHEN (j->>'applied')::boolean AND NOT (j->>'duplicate')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' same provider + ids on another website are independent');
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO n FROM public.site_payments WHERE website_id = ws_a AND provider_session_id = 'T-1001';
  r := r || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL ' || n END || ' one payment per provider for the same id');
  r := r || (CASE WHEN (SELECT NOT livemode FROM public.site_payments WHERE website_id = ws_a AND provider_session_id = 'T-test')
    THEN 'PASS' ELSE 'FAIL' END || ' test payment flagged livemode=false');
  SELECT count(*) INTO n FROM public.site_payment_events WHERE website_id = ws_a AND provider_event_id = 'ev-1';
  r := r || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL ' || n END || ' event ev-1 logged once per provider');

  -- ---------- reads ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.site_payments_list(ws_a, NULL, NULL, NULL, NULL, true, 'occurred_at', true, 100, 0, ARRAY['paystack', 'flutterwave']);
  r := r || (CASE WHEN (j->>'total')::int = 5 AND (SELECT bool_and(x->>'provider' IN ('paystack', 'flutterwave')) FROM jsonb_array_elements(j->'rows') x)
    THEN 'PASS' ELSE 'FAIL ' || (j->>'total') END || ' list filtered by provider');
  j := public.site_payments_list(ws_a, NULL, NULL, NULL, NULL, true, 'occurred_at', true, 100, 0, NULL, ARRAY['mobile_money']);
  r := r || (CASE WHEN (j->>'total')::int = 7 THEN 'PASS' ELSE 'FAIL ' || (j->>'total') END || ' list filtered by method (6 mobile money slugs + OM-1)');
  j := public.site_payments_list(ws_a, 'T-1001', NULL, NULL, NULL, true, 'provider', false, 100, 0);
  r := r || (CASE WHEN (j->>'total')::int = 2 AND j->'rows'->0->>'provider_payment_id' = 'T-1001'
    AND j->'rows'->0 ? 'provider_reference' AND j->'rows'->0 ? 'method' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' rows carry provider_payment_id / provider_reference / method');
  j := public.site_payments_summary(ws_a, 3650);
  r := r || (CASE WHEN jsonb_array_length(j->'providers') = cardinality(providers)
    AND (SELECT (x->>'count')::int FROM jsonb_array_elements(j->'providers') x WHERE x->>'provider' = 'paystack') = 2
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'currencies') x WHERE x->>'currency' = 'xof')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'methods') x WHERE x->>'method' = 'mobile_money')
    THEN 'PASS' ELSE 'FAIL ' || (j->'providers')::text END || ' summary lists providers, methods and XOF revenue');
  j := public.site_payment_detail((SELECT id FROM public.site_payments WHERE website_id = ws_a AND provider = 'paystack' AND provider_session_id = 'T-1001'));
  r := r || (CASE WHEN jsonb_array_length(j->'events') = 4 AND j->'events'->0->>'provider' = 'paystack' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' detail events carry the provider');
  EXECUTE 'RESET ROLE';

  -- ---------- isolation ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.site_payments WHERE website_id = ws_a;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' org B sees no payment of org A');
  BEGIN PERFORM public.site_payments_list(ws_a, NULL, NULL, NULL, NULL, true, 'occurred_at', true, 20, 0, ARRAY['paystack']);
    r := r || 'FAIL org B listed org A';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS org B cannot list org A (provider filter)'::text; END;
  r := r || (CASE WHEN (public.site_payments_summary(ws_a, 3650) -> 'providers') = '[]'::jsonb THEN 'PASS' ELSE 'FAIL' END || ' org B sees no provider of org A');
  j := public.site_payments_list(ws_b);
  r := r || (CASE WHEN (j->>'total')::int = 1 THEN 'PASS' ELSE 'FAIL ' || j::text END || ' org B sees only its own payment');
  EXECUTE 'RESET ROLE';

  -- ---------- revoked key ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.site_revoke_api_key(key_a_id);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM public.site_ingest_payment(key_a, base || '{"provider_event_id": "ev-after-revoke"}'); r := r || 'FAIL revoked key accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS revoked key -> 401'::text; END;
  BEGIN PERFORM public.site_ingest_payment(key_b, base || '{"provider": "wave", "provider_event_id": "w-1"}');
    r := r || 'PASS other site key still works after A revoked'::text;
  EXCEPTION WHEN OTHERS THEN r := r || ('FAIL key B refused: ' || SQLERRM); END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION E'PAYMENT PROVIDERS TESTS (rolled back): % failed\n%',
    (SELECT count(*) FROM unnest(r) x WHERE x LIKE 'FAIL%'), array_to_string(r, E'\n');
END $$;
