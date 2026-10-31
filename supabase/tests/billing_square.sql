-- Square payment links for LevelUp charges (migration billing_square): recording the
-- link and its order, the webhook with provider 'square' (order → charge, amount and
-- currency, idempotency), and the Stripe path left unchanged.
-- Always rolls back; the exception message is the report and must show `0 failed`.
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE
  u_o uuid := gen_random_uuid();   -- owner of org A
  u_v uuid := gen_random_uuid();   -- viewer of org A
  u_b uuid := gen_random_uuid();   -- owner of org B
  u_p uuid := gen_random_uuid();   -- LevelUp staff
  staff text;
  org_a uuid; org_b uuid;
  c1 uuid; c2 uuid; c_void uuid; c_b uuid; c_s uuid;
  att integer; k text; j jsonb; paid_at_1 timestamptz;
  link1 text := 'ZZLINK0000000001';
  order1 text := 'zzOrder1aaaaaaaaaaaaaaaaaaaa';
  order2 text := 'zzOrder2bbbbbbbbbbbbbbbbbbbb';
  order_v text := 'zzOrderVoidcccccccccccccccc';
  results text[] := '{}';
  failed integer;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (u_o, 'owner@zz-sq.test', 'authenticated', 'authenticated'),
    (u_v, 'viewer@zz-sq.test', 'authenticated', 'authenticated'),
    (u_b, 'owner-b@zz-sq.test', 'authenticated', 'authenticated'),
    (u_p, 'staff@zz-sq.test', 'authenticated', 'authenticated');
  INSERT INTO public.platform_admins (user_id) VALUES (u_p);
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Square A', 'zz-sq-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Square B', 'zz-sq-b') RETURNING id INTO org_b;
  INSERT INTO public.organization_members VALUES
    (org_a, u_o, 'owner'), (org_a, u_v, 'viewer'), (org_b, u_b, 'owner');
  staff := json_build_object('sub', u_p, 'role', 'authenticated', 'email', 'staff@zz-sq.test', 'aal', 'aal2')::text;

  PERFORM set_config('request.jwt.claims', staff, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  c1 := (public.admin_create_charge(org_a, 'setup', 'Website setup', NULL, 120000, 'usd', current_date + 10)->>'id')::uuid;
  c2 := (public.admin_create_charge(org_a, 'one_off', 'Logo', NULL, 4999, 'usd', current_date + 10)->>'id')::uuid;
  c_void := (public.admin_create_charge(org_a, 'one_off', 'Cancelled', NULL, 3000, 'usd', current_date + 10)->>'id')::uuid;
  c_b := (public.admin_create_charge(org_b, 'one_off', 'Other org', NULL, 1000, 'usd', current_date + 10)->>'id')::uuid;
  c_s := (public.admin_create_charge(org_a, 'one_off', 'Stripe one', NULL, 2500, 'usd', current_date + 10)->>'id')::uuid;
  k := public.admin_create_billing_webhook_key()->>'key';
  EXECUTE 'RESET ROLE';

  -- ================================================================ recording the link
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  att := (public.billing_checkout_prepare(c1)->>'attempt')::int;
  PERFORM public.billing_checkout_record_square(c1, att, link1, order1);
  j := public.billing_checkout_prepare(c1);
  results := results || (CASE WHEN j->>'session_id' = link1 AND (j->>'attempt')::int = att AND (j->>'amount')::int = 120000
    THEN 'PASS' ELSE 'FAIL ' || j::text END || ' owner records the Square link; a double click gets the same link back (same attempt, exact amount)');
  BEGIN PERFORM public.billing_checkout_record_square(c1, att + 5, 'ZZLINK0000000002', 'zzOrderXxxxxxxxxxxxxxxx'); results := results || 'FAIL link recorded for another attempt'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS a link is only recorded for the current attempt'::text; END;
  BEGIN PERFORM public.billing_checkout_record_square(c1, att, 'bad id!', order1); results := results || 'FAIL malformed link id accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS malformed link id refused'::text; END;
  BEGIN PERFORM public.billing_checkout_record_square(c_b, 1, 'ZZLINK0000000003', 'zzOrderYyyyyyyyyyyyyyyy'); results := results || 'FAIL link recorded on another org charge'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN results := results || 'PASS no link on another organization''s charge'::text; END;
  att := (public.billing_checkout_prepare(c2)->>'attempt')::int;
  PERFORM public.billing_checkout_record_square(c2, att, 'ZZLINK0000000004', order2);
  -- The same order can never be moved to another charge.
  BEGIN PERFORM public.billing_checkout_record_square(c2, att, 'ZZLINK0000000004', order1); results := results || 'FAIL order moved to another charge'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS an order recorded for one charge is never moved to another'::text; END;
  att := (public.billing_checkout_prepare(c_void)->>'attempt')::int;
  PERFORM public.billing_checkout_record_square(c_void, att, 'ZZLINK0000000005', order_v);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.billing_checkout_record_square(c1, 1, link1, order1); results := results || 'FAIL viewer recorded a link'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN results := results || 'PASS viewers cannot record a link'::text; END;
  BEGIN PERFORM count(*) FROM private.billing_square_orders; results := results || 'FAIL users read the order map'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS the order map is closed to API roles'::text; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', staff, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.admin_void_charge(c_void, 'Cancelled by LevelUp');
  EXECUTE 'RESET ROLE';

  -- ================================================================ webhook (provider square)
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM public.billing_ingest_stripe_event('lu_bill_' || repeat('0', 48), jsonb_build_object('provider', 'square'));
    results := results || 'FAIL square event with an unknown key'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN results := results || 'PASS square events need the billing webhook key'::text; END;
  BEGIN PERFORM public.billing_ingest_stripe_event(k, jsonb_build_object('provider', 'paypal', 'event_id', 'zz-evt-0000001'));
    results := results || 'FAIL unknown provider accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS unknown provider refused'::text; END;
  BEGIN PERFORM public.billing_ingest_stripe_event(k, jsonb_build_object('provider', 'square', 'event_id', 'zz-evt-0000002',
      'type', 'refund.updated', 'payment_id', 'zzPay0000001', 'order_id', order1));
    results := results || 'FAIL other square event type accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS only payment.created / payment.updated'::text; END;

  j := public.billing_ingest_stripe_event(k, jsonb_build_object('provider', 'square', 'event_id', 'zz-evt-approved1',
    'type', 'payment.created', 'payment_id', 'zzPay0000001', 'order_id', order1, 'charge_id', c1,
    'amount', 120000, 'currency', 'usd', 'payment_status', 'APPROVED', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'not_paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' an APPROVED payment changes nothing yet');
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('provider', 'square', 'event_id', 'zz-evt-wrongamt1',
    'type', 'payment.updated', 'payment_id', 'zzPay0000001', 'order_id', order1, 'charge_id', c1,
    'amount', 119999, 'currency', 'usd', 'payment_status', 'COMPLETED', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'amount_mismatch' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' wrong amount (cents) refused');
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('provider', 'square', 'event_id', 'zz-evt-wrongcur1',
    'type', 'payment.updated', 'payment_id', 'zzPay0000001', 'order_id', order1, 'charge_id', c1,
    'amount', 120000, 'currency', 'cad', 'payment_status', 'COMPLETED', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'amount_mismatch' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' wrong currency refused');
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('provider', 'square', 'event_id', 'zz-evt-unknownord',
    'type', 'payment.updated', 'payment_id', 'zzPay0000009', 'order_id', 'zzOrderNotOurszzzzzzzzzz', 'charge_id', c1,
    'amount', 120000, 'currency', 'usd', 'payment_status', 'COMPLETED', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'unknown_charge' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' an order we never created maps to no charge (payment note alone is not trusted)');
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('provider', 'square', 'event_id', 'zz-evt-notemism1',
    'type', 'payment.updated', 'payment_id', 'zzPay0000001', 'order_id', order1, 'charge_id', c2,
    'amount', 120000, 'currency', 'usd', 'payment_status', 'COMPLETED', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'unknown_charge' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' payment note naming another charge than the order refused');
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN (SELECT status FROM public.billing_charges WHERE id = c1) = 'due'
      AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'billing.online_payment_amount_mismatch' AND target_id = org_a::text
        AND metadata->>'provider' = 'square')
      AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'billing.online_payment_unknown_charge' AND metadata->>'provider' = 'square')
    THEN 'PASS' ELSE 'FAIL' END || ' after refused events the charge is still due; mismatches audited for staff');

  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('provider', 'square', 'event_id', 'zz-evt-completed1',
    'type', 'payment.updated', 'payment_id', 'zzPay0000001', 'order_id', order1, 'charge_id', c1,
    'amount', 120000, 'currency', 'usd', 'payment_status', 'COMPLETED', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' COMPLETED payment of the right amount marks the charge paid');
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('provider', 'square', 'event_id', 'zz-evt-completed1',
    'type', 'payment.updated', 'payment_id', 'zzPay0000001', 'order_id', order1, 'charge_id', c1,
    'amount', 120000, 'currency', 'usd', 'payment_status', 'COMPLETED', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'duplicate' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' the same event again is ignored (duplicate)');
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('provider', 'square', 'event_id', 'zz-evt-completed2',
    'type', 'payment.updated', 'payment_id', 'zzPay0000001', 'order_id', order1, 'charge_id', c1,
    'amount', 120000, 'currency', 'usd', 'payment_status', 'COMPLETED', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'duplicate' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' another notification about the same payment is a duplicate, not a double payment');
  EXECUTE 'RESET ROLE';
  SELECT paid_at INTO paid_at_1 FROM public.billing_charges WHERE id = c1;
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('provider', 'square', 'event_id', 'zz-evt-secondpay',
    'type', 'payment.updated', 'payment_id', 'zzPay0000002', 'order_id', order1, 'charge_id', c1,
    'amount', 120000, 'currency', 'usd', 'payment_status', 'COMPLETED', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'already_paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' a second, different payment of a paid charge is flagged (already_paid), never applied');
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('provider', 'square', 'event_id', 'zz-evt-voidpay01',
    'type', 'payment.updated', 'payment_id', 'zzPay0000003', 'order_id', order_v, 'charge_id', c_void,
    'amount', 3000, 'currency', 'usd', 'payment_status', 'COMPLETED', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'charge_closed' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' payment of a void charge is flagged, never applied');
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN (SELECT status = 'paid' AND payment_method = 'card' AND payment_provider = 'square'
        AND provider_session_id = order1 AND payment_reference = 'zzPay0000001' AND paid_amount = 120000 AND paid_at = paid_at_1
        FROM public.billing_charges WHERE id = c1)
      AND (SELECT status FROM public.billing_charges WHERE id = c_void) = 'void'
      AND (SELECT count(*) FROM public.billing_payment_events WHERE charge_id = c1 AND provider = 'square') = 6
      AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'billing.charge_paid_online' AND target_id = org_a::text
        AND metadata->>'provider' = 'square' AND metadata->>'payment_id' = 'zzPay0000001')
      AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'billing.online_payment_already_paid' AND metadata->>'payment_id' = 'zzPay0000002')
      AND NOT EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action LIKE 'billing.online_payment_%' AND metadata->>'event_id' = 'zz-evt-completed2')
    THEN 'PASS' ELSE 'FAIL' END || ' paid once: method card, provider square, order + payment id, amount; events kept; audited');
  results := results || (CASE WHEN (SELECT expires_at <= now() FROM private.billing_checkouts WHERE charge_id = c1)
    THEN 'PASS' ELSE 'FAIL' END || ' the attempt is closed once paid');

  -- Receipt shows the online card payment (owner).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.billing_checkout_prepare(c1); results := results || 'FAIL checkout of a charge paid through Square'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'charge_closed' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' no new checkout once paid through Square'); END;
  EXECUTE 'RESET ROLE';

  -- ================================================================ Stripe path unchanged
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.billing_checkout_record(c_s, (public.billing_checkout_prepare(c_s)->>'attempt')::int, 'cs_test_' || md5(c_s::text));
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('event_id', 'evt_zzsqstripe0001', 'type', 'checkout.session.completed',
    'session_id', 'cs_test_' || md5(c_s::text), 'charge_id', c_s, 'organization_id', org_a, 'amount', 2500, 'currency', 'usd',
    'payment_status', 'paid', 'payment_intent', 'pi_zzsq1', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' Stripe events (no provider field) still pay a charge');
  j := public.billing_ingest_stripe_event(k, jsonb_build_object('event_id', 'evt_zzsqstripe0002', 'type', 'checkout.session.async_payment_succeeded',
    'session_id', 'cs_test_' || md5(c_s::text), 'charge_id', c_s, 'organization_id', org_a, 'amount', 2500, 'currency', 'usd',
    'payment_status', 'paid', 'livemode', false));
  results := results || (CASE WHEN j->>'status' = 'already_paid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' Stripe: a second event for a paid charge is still already_paid');
  BEGIN PERFORM public.billing_ingest_stripe_event(k, jsonb_build_object('event_id', 'evt_zzsqstripe0003', 'type', 'payment.updated',
      'session_id', 'cs_test_' || md5(c_s::text)));
    results := results || 'FAIL Square event type accepted on the Stripe path'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS Square event types are refused on the Stripe path'::text; END;
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN (SELECT payment_provider = 'stripe' AND payment_reference = 'pi_zzsq1' FROM public.billing_charges WHERE id = c_s)
      AND (SELECT provider FROM public.billing_payment_events WHERE provider_event_id = 'evt_zzsqstripe0001') = 'stripe'
    THEN 'PASS' ELSE 'FAIL' END || ' Stripe payment recorded with provider stripe');

  SELECT count(*) INTO failed FROM unnest(results) r WHERE r LIKE 'FAIL%';
  RAISE EXCEPTION E'% failed, % passed\n%', failed, cardinality(results) - failed, array_to_string(results, E'\n');
END;
$$;
