-- Billing: plans and limits, organization billing, charges, discounts, promo codes,
-- upgrade requests (migrations billing_schema, billing_functions, billing_limits,
-- billing_usage). Always rolls back; the exception message is the report and must
-- show `0 failed`.
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE
  u_o uuid := gen_random_uuid();   -- owner of org A
  u_a uuid := gen_random_uuid();   -- admin of org A
  u_v uuid := gen_random_uuid();   -- viewer of org A
  u_b uuid := gen_random_uuid();   -- owner of org B
  u_c uuid := gen_random_uuid();   -- owner of org C
  u_p uuid := gen_random_uuid();   -- LevelUp platform admin
  org_a uuid; org_b uuid; org_c uuid;
  j jsonb; ch jsonb; ch2 jsonb; d_partner uuid; d_code uuid; d_old uuid; req uuid;
  n integer; s text;
  results text[] := '{}';
  failed integer;
BEGIN
  -- Known plan state for the run (rolled back).
  UPDATE public.plans SET limits = '{"team_members": 2, "assistant_requests_month": 50, "media_mb": 500, "websites": 1}',
    price_monthly = 0, currency = 'usd' WHERE key = 'free';
  UPDATE public.plans SET limits = '{"team_members": 5, "assistant_requests_month": 200, "media_mb": 2000, "websites": 1}',
    price_monthly = NULL, currency = 'usd', active = true WHERE key = 'starter';
  UPDATE public.plans SET price_monthly = NULL, active = true WHERE key = 'pro';

  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES
    (u_o, 'owner@zz-bill.test', 'authenticated', 'authenticated', now()),
    (u_a, 'admin@zz-bill.test', 'authenticated', 'authenticated', now()),
    (u_v, 'viewer@zz-bill.test', 'authenticated', 'authenticated', now()),
    (u_b, 'owner-b@zz-bill.test', 'authenticated', 'authenticated', now()),
    (u_c, 'owner-c@zz-bill.test', 'authenticated', 'authenticated', now()),
    (u_p, 'staff@zz-bill.test', 'authenticated', 'authenticated', now());
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Bill A', 'zz-bill-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Bill B', 'zz-bill-b') RETURNING id INTO org_b;
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Bill C', 'zz-bill-c') RETURNING id INTO org_c;
  INSERT INTO public.organization_members VALUES (org_a, u_o, 'owner'), (org_a, u_v, 'viewer'),
    (org_b, u_b, 'owner'), (org_c, u_c, 'owner');
  INSERT INTO public.platform_admins (user_id) VALUES (u_p);

  -- Default plan without a billing row.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.billing_summary(org_a);
  results := results || (CASE WHEN j->'plan'->>'key' = 'free' AND j->>'status' = 'active' AND (j->>'can_manage')::boolean
    AND j->'money'->>'price_state' = 'free' AND (j->'money'->>'price')::int = 0
    AND (SELECT (u->>'used')::int FROM jsonb_array_elements(j->'usage') u WHERE u->>'key' = 'team_members') = 2
    THEN 'PASS' ELSE 'FAIL' END || ' no billing row: default Free plan, 2 seats used, owner sees the money');
  EXECUTE 'RESET ROLE';

  -- Members see the plan, not the money.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.billing_summary(org_a);
  results := results || (CASE WHEN j->'plan'->>'key' = 'free' AND jsonb_typeof(j->'money') = 'null'
    AND NOT (j->>'can_manage')::boolean
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'plans') p WHERE p->>'price' IS NOT NULL)
    THEN 'PASS' ELSE 'FAIL' END || ' viewer: plan and usage, no prices, charges or discounts');
  j := public.billing_usage(org_a);
  results := results || (CASE WHEN (j->>'team_members')::int = 2 AND (j->>'storage_bytes')::bigint = 0
    AND (j->>'chat_messages_month')::int = 0 AND (j->>'assistant_requests_month')::int = 0
    THEN 'PASS' ELSE 'FAIL' END || ' usage panel: real counts for a member');
  BEGIN PERFORM public.redeem_discount_code(org_a, 'ANYCODE'); results := results || 'FAIL viewer redeemed'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS viewers cannot redeem codes'::text; END;
  BEGIN PERFORM public.request_plan_upgrade(org_a, 'pro'); results := results || 'FAIL viewer requested'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS viewers cannot request an upgrade'::text; END;
  EXECUTE 'RESET ROLE';

  -- Isolation between organizations.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.billing_summary(org_a); results := results || 'FAIL other org read A summary'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS another organization cannot read the summary'::text; END;
  BEGIN PERFORM public.billing_usage(org_a); results := results || 'FAIL other org read A usage'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS another organization cannot read the usage'::text; END;
  EXECUTE 'RESET ROLE';

  -- Clients never write billing, never read the tables, never call staff functions.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN INSERT INTO public.organization_billing (organization_id, plan_key) VALUES (org_a, 'pro'); results := results || 'FAIL client wrote billing'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS client cannot insert organization_billing'::text; END;
  BEGIN INSERT INTO public.billing_charges (organization_id, label, kind, base_amount, currency) VALUES (org_a, 'x', 'one_off', 1, 'usd'); results := results || 'FAIL client wrote a charge'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS client cannot insert charges'::text; END;
  BEGIN UPDATE public.plans SET price_monthly = 1 WHERE key = 'pro'; results := results || 'FAIL client updated a plan'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS client cannot update plans'::text; END;
  BEGIN INSERT INTO public.discounts (organization_id, label, kind, value) VALUES (org_a, 'Me', 'percent', 90); results := results || 'FAIL client wrote a discount'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS client cannot insert discounts'::text; END;
  BEGIN PERFORM public.admin_set_org_billing(org_a, 'business', 'active', 0, 'usd', NULL, NULL); results := results || 'FAIL owner set own plan'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS owner cannot set the plan or a price'::text; END;
  BEGIN PERFORM public.admin_save_plan('pro', 'Pro', NULL, 1, 'usd', '{}', '{}', 20, true, false); results := results || 'FAIL owner priced a plan'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS non-staff cannot edit plan prices'::text; END;
  BEGIN PERFORM public.admin_create_charge(org_a, 'one_off', 'x', NULL, 100); results := results || 'FAIL owner created a charge'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS non-staff cannot create charges'::text; END;
  BEGIN PERFORM public.admin_save_discount(NULL, org_a, NULL, 'Self', 'percent', 100); results := results || 'FAIL owner created a discount'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS non-staff cannot create discounts'::text; END;
  EXECUTE 'RESET ROLE';

  -- Limit: team members (Free = 2 seats; owner + viewer already).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.create_organization_invitation(org_a, 'third@zz-bill.test', 'editor');
    results := results || 'FAIL invitation over the plan limit'::text;
  EXCEPTION WHEN SQLSTATE 'PT402' THEN
    GET STACKED DIAGNOSTICS s = PG_EXCEPTION_DETAIL;
    results := results || (CASE WHEN SQLERRM = 'plan_limit_reached' AND (s::jsonb)->>'key' = 'team_members'
      AND ((s::jsonb)->>'limit')::int = 2 AND (s::jsonb)->>'plan' = 'free'
      THEN 'PASS' ELSE 'FAIL ' || SQLERRM || ' ' || coalesce(s, '') END || ' invite past the seat limit: plan_limit_reached with key and limit');
  END;
  BEGIN
    PERFORM public.add_organization_member(org_a, 'admin@zz-bill.test', 'admin');
    results := results || 'FAIL add member over the plan limit'::text;
  EXCEPTION WHEN SQLSTATE 'PT402' THEN results := results || 'PASS adding an existing account counts the seat too'::text; END;
  results := results || (CASE WHEN public.add_organization_member(org_a, 'viewer@zz-bill.test', 'editor') = 'updated'
    THEN 'PASS' ELSE 'FAIL' END || ' role change of a member never hits the seat limit');
  EXECUTE 'RESET ROLE';

  -- Staff moves A to Starter (5 seats), custom price, note, due date.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated', 'email', 'staff@zz-bill.test', 'aal', 'aal2')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.admin_set_org_billing(org_a, 'starter', 'active', NULL, 'usd', 'Paid by bank transfer', current_date + 10);
  BEGIN PERFORM public.admin_create_charge(org_a, 'subscription', 'October'); results := results || 'FAIL subscription without a price'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'price_not_set' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' subscription charge refused while the price is not set'); END;
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'billing.org_updated' AND target_id = org_a::text
    AND metadata->>'plan' = 'starter' AND actor_id = u_p)
    THEN 'PASS' ELSE 'FAIL' END || ' plan change audited');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.create_organization_invitation(org_a, 'third@zz-bill.test', 'editor');
  results := results || (CASE WHEN j ? 'token' THEN 'PASS' ELSE 'FAIL' END || ' after the upgrade the invitation goes through');
  PERFORM public.create_organization_invitation(org_a, 'fourth@zz-bill.test', 'editor');
  PERFORM public.create_organization_invitation(org_a, 'fifth@zz-bill.test', 'editor');
  -- 5 seats used (2 members + 3 invitations): re-sending to a pending address keeps its seat.
  j := public.create_organization_invitation(org_a, 'fifth@zz-bill.test', 'viewer');
  results := results || (CASE WHEN j ? 'token' THEN 'PASS' ELSE 'FAIL' END || ' re-inviting a pending address does not take a new seat');
  BEGIN PERFORM public.create_organization_invitation(org_a, 'sixth@zz-bill.test', 'editor'); results := results || 'FAIL sixth seat'::text;
  EXCEPTION WHEN SQLSTATE 'PT402' THEN results := results || 'PASS pending invitations count as seats'::text; END;
  j := public.billing_summary(org_a);
  results := results || (CASE WHEN j->'plan'->>'key' = 'starter' AND j->'money'->>'price_state' = 'unset'
    AND j->'money'->>'price' IS NULL AND j->'money'->>'note' = 'Paid by bank transfer'
    AND (j->'money'->>'next_due_date')::date = current_date + 10
    THEN 'PASS' ELSE 'FAIL' END || ' unset price is null (never a made-up number), note and due date shown');
  EXECUTE 'RESET ROLE';

  -- Limit: assistant requests per month (Free = 50) on org B. 49 used today; the
  -- daily safety cap (60) is not reached.
  INSERT INTO public.ai_usage (organization_id, day, feature, count)
  VALUES (org_b, (now() at time zone 'utc')::date, 'assistant', 49);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  n := public.assistant_consume(org_b);
  results := results || (CASE WHEN n = 10 THEN 'PASS' ELSE 'FAIL ' || n END || ' 50th request of the month allowed');
  BEGIN
    PERFORM public.assistant_consume(org_b);
    results := results || 'FAIL 51st request of the month allowed'::text;
  EXCEPTION WHEN SQLSTATE 'PT402' THEN
    GET STACKED DIAGNOSTICS s = PG_EXCEPTION_DETAIL;
    results := results || (CASE WHEN SQLERRM = 'plan_limit_reached' AND (s::jsonb)->>'key' = 'assistant_requests_month'
      AND ((s::jsonb)->>'limit')::int = 50
      THEN 'PASS' ELSE 'FAIL ' || coalesce(s, '') END || ' assistant: 50 per month on Free, then plan_limit_reached');
  END;
  results := results || (CASE WHEN (public.billing_usage(org_b)->>'assistant_requests_month')::int = 50
    THEN 'PASS' ELSE 'FAIL' END || ' a refused request is not counted');
  EXECUTE 'RESET ROLE';

  -- Discounts: math, rounding, best one, expiry, scope, currency.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated', 'email', 'staff@zz-bill.test', 'aal', 'aal2')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.admin_set_org_billing(org_a, 'starter', 'active', 1999, 'usd', NULL, NULL);
  d_partner := public.admin_save_discount(NULL, org_a, NULL, 'Partner', 'percent', 20, NULL, 'all');
  ch := public.admin_create_charge(org_a, 'subscription', 'Subscription — November');
  results := results || (CASE WHEN (ch->>'base_amount')::int = 1999 AND (ch->>'discount_amount')::int = 400
    AND (ch->>'amount')::int = 1599 AND ch->>'discount_label' = 'Partner' AND ch->>'currency' = 'usd'
    THEN 'PASS' ELSE 'FAIL ' || ch::text END || ' subscription amount from the custom price, 20% of 19.99 rounds to 4.00');
  ch := public.admin_create_charge(org_a, 'one_off', 'Logo', NULL, 333, 'usd', NULL, true);
  results := results || (CASE WHEN (ch->>'discount_amount')::int = 67 AND (ch->>'amount')::int = 266
    THEN 'PASS' ELSE 'FAIL ' || ch::text END || ' 20% of 3.33 = 0.666 rounds half up to 0.67');
  ch := public.admin_create_charge(org_a, 'one_off', 'No discount', NULL, 1000, 'usd', NULL, false);
  results := results || (CASE WHEN (ch->>'discount_amount')::int = 0 AND (ch->>'amount')::int = 1000 AND ch->>'discount_label' IS NULL
    THEN 'PASS' ELSE 'FAIL' END || ' discount can be left out of a charge');
  PERFORM public.admin_save_discount(NULL, org_a, NULL, 'Launch', 'fixed', 5000, 'usd', 'setup');
  ch := public.admin_create_charge(org_a, 'setup', 'Website setup', NULL, 30000, 'usd', current_date + 30);
  results := results || (CASE WHEN ch->>'discount_label' = 'Partner' AND (ch->>'discount_amount')::int = 6000
    THEN 'PASS' ELSE 'FAIL ' || ch::text END || ' best discount wins (20% of 300 beats 50 off), never stacked');
  ch := public.admin_create_charge(org_a, 'setup', 'Small setup', NULL, 3000, 'usd');
  results := results || (CASE WHEN ch->>'discount_label' = 'Launch' AND (ch->>'amount')::int = 0
    THEN 'PASS' ELSE 'FAIL ' || ch::text END || ' fixed discount capped at the charge (never negative)');
  ch := public.admin_create_charge(org_a, 'subscription', 'CAD charge', NULL, 1000, 'cad');
  results := results || (CASE WHEN ch->>'discount_label' = 'Partner' AND (ch->>'discount_amount')::int = 200
    THEN 'PASS' ELSE 'FAIL ' || ch::text END || ' fixed discount in another currency ignored, percent applies');
  PERFORM public.admin_set_discount_active(d_partner, false);
  ch := public.admin_create_charge(org_a, 'one_off', 'After deactivation', NULL, 1000, 'usd');
  results := results || (CASE WHEN (ch->>'discount_amount')::int = 0 THEN 'PASS' ELSE 'FAIL' END || ' deactivated discount no longer applies');
  d_old := public.admin_save_discount(NULL, org_a, NULL, 'Old promo', 'percent', 50, NULL, 'all', now() - interval '30 days', now() - interval '1 day');
  PERFORM public.admin_save_discount(NULL, org_a, NULL, 'Future promo', 'percent', 60, NULL, 'all', now() + interval '1 day', NULL);
  ch := public.admin_create_charge(org_a, 'one_off', 'Dates', NULL, 1000, 'usd');
  results := results || (CASE WHEN (ch->>'discount_amount')::int = 0 THEN 'PASS' ELSE 'FAIL ' || ch::text END || ' expired and not-yet-started discounts ignored');
  BEGIN PERFORM public.admin_save_discount(NULL, org_a, NULL, 'Too much', 'percent', 101); results := results || 'FAIL 101%'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'invalid_value' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' percent above 100 refused'); END;
  BEGIN PERFORM public.admin_create_charge(org_a, 'one_off', 'Negative', NULL, -5, 'usd'); results := results || 'FAIL negative charge'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'invalid_amount' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' negative amount refused'); END;

  -- Charge lifecycle: edit, mark paid, void, overdue, total due.
  ch2 := public.admin_create_charge(org_a, 'one_off', 'Late', NULL, 500, 'usd', current_date - 3);
  ch2 := public.admin_update_charge((ch2->>'id')::uuid, 'Late fee', NULL, 700, current_date - 3);
  results := results || (CASE WHEN (ch2->>'amount')::int = 700 AND ch2->>'status' = 'overdue' AND ch2->>'label' = 'Late fee'
    THEN 'PASS' ELSE 'FAIL ' || ch2::text END || ' edited charge, past due date reported as overdue');
  ch := public.admin_mark_charge_paid((ch2->>'id')::uuid, NULL, 'Bank transfer');
  results := results || (CASE WHEN ch->>'status' = 'paid' AND ch->>'paid_at' IS NOT NULL AND ch->>'payment_note' = 'Bank transfer'
    THEN 'PASS' ELSE 'FAIL' END || ' marked paid manually');
  BEGIN PERFORM public.admin_void_charge((ch2->>'id')::uuid); results := results || 'FAIL voided a paid charge'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'charge_paid' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' a paid charge cannot be voided'); END;
  BEGIN PERFORM public.admin_update_charge((ch2->>'id')::uuid, 'x', NULL, 1, NULL); results := results || 'FAIL edited a paid charge'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'charge_closed' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' a paid charge cannot be edited'); END;
  ch := public.admin_create_charge(org_a, 'one_off', 'Mistake', NULL, 99999, 'usd');
  ch := public.admin_void_charge((ch->>'id')::uuid, 'Created by mistake');
  results := results || (CASE WHEN ch->>'status' = 'void' THEN 'PASS' ELSE 'FAIL' END || ' charge voided');
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN (SELECT count(*) FROM public.hq_audit_log WHERE target_id = org_a::text
      AND action IN ('billing.charge_created', 'billing.charge_updated', 'billing.charge_paid', 'billing.charge_voided')) >= 11
    THEN 'PASS' ELSE 'FAIL' END || ' charge changes audited');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.billing_summary(org_a);
  results := results || (CASE WHEN
    (SELECT (t->>'amount')::bigint FROM jsonb_array_elements(j->'money'->'total_due') t WHERE t->>'currency' = 'usd')
      = (1599 + 266 + 1000 + 24000 + 0 + 1000 + 1000)
    AND (SELECT (t->>'amount')::bigint FROM jsonb_array_elements(j->'money'->'total_due') t WHERE t->>'currency' = 'cad') = 800
    THEN 'PASS' ELSE 'FAIL ' || (j->'money'->'total_due')::text END || ' total due per currency excludes paid and void charges');
  results := results || (CASE WHEN NOT EXISTS (SELECT 1 FROM public.billing_charges) AND NOT EXISTS (SELECT 1 FROM public.discounts)
    THEN 'PASS' ELSE 'FAIL' END || ' tables are closed to clients (staff-only RLS)');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.billing_summary(org_b);
  results := results || (CASE WHEN jsonb_array_length(j->'money'->'charges') = 0 AND jsonb_array_length(j->'money'->'discounts') = 0
    THEN 'PASS' ELSE 'FAIL' END || ' org B sees none of org A''s charges or discounts');
  EXECUTE 'RESET ROLE';

  -- Promo codes: single use per organization, max uses, bound codes, expiry, rate limit.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated', 'email', 'staff@zz-bill.test', 'aal', 'aal2')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  d_code := public.admin_save_discount(NULL, NULL, 'welcome-10', 'Welcome', 'percent', 10, NULL, 'subscription', NULL, NULL, 2);
  PERFORM public.admin_save_discount(NULL, NULL, 'EXPIRED-1', 'Old', 'percent', 10, NULL, 'all', now() - interval '10 days', now() - interval '1 day');
  PERFORM public.admin_save_discount(NULL, org_c, 'ONLY-C', 'C only', 'percent', 5);
  BEGIN PERFORM public.admin_save_discount(NULL, NULL, 'WELCOME-10', 'Dup', 'percent', 5); results := results || 'FAIL duplicate code'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'code_taken' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' codes are unique (case-insensitive)'); END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.redeem_discount_code(org_b, ' welcome-10 ');
  results := results || (CASE WHEN j->>'status' = 'redeemed' AND j->'discount'->>'label' = 'Welcome' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' code redeemed (trimmed, any case)');
  results := results || (CASE WHEN public.redeem_discount_code(org_b, 'WELCOME-10')->>'status' = 'already_redeemed'
    THEN 'PASS' ELSE 'FAIL' END || ' a code is single-use per organization');
  results := results || (CASE WHEN public.redeem_discount_code(org_b, 'EXPIRED-1')->>'status' = 'invalid'
    AND public.redeem_discount_code(org_b, 'ONLY-C')->>'status' = 'invalid'
    THEN 'PASS' ELSE 'FAIL' END || ' expired code and code bound to another organization: invalid');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_c, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.redeem_discount_code(org_c, 'ONLY-C')->>'status' = 'redeemed'
    AND public.redeem_discount_code(org_c, 'WELCOME-10')->>'status' = 'redeemed'
    THEN 'PASS' ELSE 'FAIL' END || ' bound code works for its organization; second org redeems the shared code');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.redeem_discount_code(org_a, 'WELCOME-10')->>'status' = 'invalid'
    THEN 'PASS' ELSE 'FAIL' END || ' max uses reached: third organization refused');
  n := 1;
  BEGIN
    FOR i IN 1..10 LOOP
      PERFORM public.redeem_discount_code(org_a, 'NOPE-' || i);
      n := n + 1;
    END LOOP;
    results := results || 'FAIL redemption not rate limited'::text;
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    results := results || (CASE WHEN n = 5 THEN 'PASS' ELSE 'FAIL ' || n END || ' redemption rate limited (5 per hour per organization, failures count)');
  END;
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN (SELECT uses FROM public.discounts WHERE id = d_code) = 2
    AND (SELECT count(*) FROM public.discount_redemptions WHERE discount_id = d_code) = 2
    THEN 'PASS' ELSE 'FAIL' END || ' uses counted once per redemption');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated', 'email', 'staff@zz-bill.test', 'aal', 'aal2')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.admin_set_org_billing(org_b, 'starter', 'trial', 2000, 'usd', NULL, NULL);
  ch := public.admin_create_charge(org_b, 'subscription', 'Subscription');
  results := results || (CASE WHEN ch->>'discount_label' = 'Welcome' AND (ch->>'amount')::int = 1800
    THEN 'PASS' ELSE 'FAIL ' || ch::text END || ' redeemed code applies to the organization''s subscription charge');
  ch := public.admin_create_charge(org_b, 'setup', 'Setup', NULL, 2000, 'usd');
  results := results || (CASE WHEN (ch->>'discount_amount')::int = 0 THEN 'PASS' ELSE 'FAIL' END || ' subscription-only code does not reduce a setup charge');
  EXECUTE 'RESET ROLE';

  -- Upgrade requests.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_c, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.request_plan_upgrade(org_c, 'pro', 'We need more seats');
  req := (j->>'id')::uuid;
  results := results || (CASE WHEN NOT (j->>'already')::boolean AND j->>'plan_name' = 'Pro' AND j->>'from_plan_name' = 'Free'
    AND (public.request_plan_upgrade(org_c, 'pro')->>'already')::boolean
    AND public.billing_summary(org_c)->'pending_request'->>'plan_key' = 'pro'
    THEN 'PASS' ELSE 'FAIL' END || ' upgrade request stored once, shown as requested');
  BEGIN PERFORM public.request_plan_upgrade(org_c, 'free'); results := results || 'FAIL request for the current plan'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'already_on_plan' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' request for the current plan refused'); END;
  BEGIN PERFORM public.admin_decide_upgrade_request(req, true); results := results || 'FAIL client approved own request'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS client cannot approve its own request'::text; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated', 'email', 'staff@zz-bill.test', 'aal', 'aal2')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(public.admin_list_upgrade_requests()) r
      WHERE (r->>'id')::uuid = req AND r->>'status' = 'pending' AND r->>'organization_name' = 'Zz Bill C')
    THEN 'PASS' ELSE 'FAIL' END || ' staff see the pending request');
  PERFORM public.admin_decide_upgrade_request(req, true, NULL);
  results := results || (CASE WHEN (SELECT plan_key FROM public.organization_billing WHERE organization_id = org_c) = 'pro'
    AND (SELECT status FROM public.plan_upgrade_requests WHERE id = req) = 'approved'
    THEN 'PASS' ELSE 'FAIL' END || ' approval sets the plan');
  BEGIN PERFORM public.admin_decide_upgrade_request(req, false); results := results || 'FAIL decided twice'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'request_closed' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' a decided request stays closed'); END;

  -- Plans: price and limits by staff only, validated, default kept.
  PERFORM public.admin_save_plan('pro', 'Pro', NULL, 4900, 'USD', '{"team_members": 15, "websites": null}', ARRAY['payments', 'seo_tools'], 20, true, false);
  results := results || (CASE WHEN (SELECT price_monthly = 4900 AND currency = 'usd' AND limits = '{"team_members": 15, "websites": null}'::jsonb
      FROM public.plans WHERE key = 'pro')
    THEN 'PASS' ELSE 'FAIL' END || ' staff set a plan price, currency and limits');
  BEGIN PERFORM public.admin_save_plan('pro', 'Pro', NULL, 4900, 'usd', '{"unknown_key": 1}', '{}', 20, true, false); results := results || 'FAIL unknown limit'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'invalid_limits' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' unknown limit keys refused'); END;
  BEGIN PERFORM public.admin_save_plan('free', 'Free', NULL, 0, 'usd', '{}', '{}', 0, false, false); results := results || 'FAIL default deactivated'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'default_plan_required' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' the default plan cannot be switched off'); END;
  j := public.admin_list_billing_orgs();
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(j) o WHERE (o->>'organization_id')::uuid = org_c
      AND o->>'plan_key' = 'pro' AND o->>'price_state' = 'set' AND (o->>'price')::int = 4900)
    THEN 'PASS' ELSE 'FAIL' END || ' staff list: plan and price per organization');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_c, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.billing_summary(org_c);
  results := results || (CASE WHEN j->'money'->>'price_state' = 'set' AND (j->'money'->>'price')::int = 4900
    AND (j->'money'->>'price_after_discount')::int = 4410 AND j->'money'->'subscription_discount'->>'label' = 'Welcome'
    AND jsonb_typeof(j->'pending_request') = 'null'
    THEN 'PASS' ELSE 'FAIL ' || (j->'money')::text END || ' client sees the plan price after its discount');
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO failed FROM unnest(results) r WHERE r LIKE 'FAIL%';
  RAISE EXCEPTION E'% failed, % passed\n%', failed, cardinality(results) - failed, array_to_string(results, E'\n');
END;
$$;
