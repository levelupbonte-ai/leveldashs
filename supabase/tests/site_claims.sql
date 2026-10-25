-- Owner e-mail auto-link and one-time activation codes (migration site_owner_claims).
-- Always rolls back; the exception message is the report and must show `0 failed`.
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE
  u_p uuid := gen_random_uuid();   -- LevelUp staff
  u_c uuid := gen_random_uuid();   -- client redeeming a code
  u_x uuid := gen_random_uuid();   -- someone else
  u_n uuid := gen_random_uuid();   -- unconfirmed
  u_b uuid := gen_random_uuid();   -- bound e-mail
  u_r uuid := gen_random_uuid();   -- brute force
  u_o uuid := gen_random_uuid();   -- existing owner
  u_cl uuid;
  org_a uuid; org_b uuid; org_c uuid; org_d uuid; org_e uuid; org_owned uuid;
  ws_a text; ws_b text; ws_c text; ws_d text; ws_e text; ws_owned text;
  j jsonb; code text; code2 text; n integer; s text; ok boolean;
  results text[] := '{}';
  failed integer;
BEGIN
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES
    (u_p, 'staff@zz-claim.test', 'authenticated', 'authenticated', now()),
    (u_c, 'client@zz-claim.test', 'authenticated', 'authenticated', now()),
    (u_x, 'other@zz-claim.test', 'authenticated', 'authenticated', now()),
    (u_n, 'unconfirmed@zz-claim.test', 'authenticated', 'authenticated', NULL),
    (u_b, 'bound@zz-claim.test', 'authenticated', 'authenticated', now()),
    (u_r, 'robot@zz-claim.test', 'authenticated', 'authenticated', now()),
    (u_o, 'existing-owner@zz-claim.test', 'authenticated', 'authenticated', now());
  INSERT INTO public.platform_admins (user_id) VALUES (u_p);
  INSERT INTO public.organizations (name, slug) VALUES ('Zz A', 'zz-claim-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('Zz B', 'zz-claim-b') RETURNING id INTO org_b;
  INSERT INTO public.organizations (name, slug) VALUES ('Zz C', 'zz-claim-c') RETURNING id INTO org_c;
  INSERT INTO public.organizations (name, slug) VALUES ('Zz D', 'zz-claim-d') RETURNING id INTO org_d;
  INSERT INTO public.organizations (name, slug) VALUES ('Zz E', 'zz-claim-e') RETURNING id INTO org_e;
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Owned', 'zz-claim-owned') RETURNING id INTO org_owned;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'A', 'active') RETURNING id INTO ws_a;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_b, 'B', 'active') RETURNING id INTO ws_b;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_c, 'C', 'active') RETURNING id INTO ws_c;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_d, 'D', 'active') RETURNING id INTO ws_d;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_e, 'E', 'active') RETURNING id INTO ws_e;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_owned, 'Owned', 'active') RETURNING id INTO ws_owned;
  INSERT INTO public.organization_members VALUES (org_owned, u_o, 'owner');
  INSERT INTO public.access_requests (user_id, business_name) VALUES (u_c, 'Client Co');

  -- Code generation: format, uniqueness, every character of the alphabet used.
  SELECT count(*) = 300 AND count(DISTINCT c) = 300 AND bool_and(c ~ '^LVL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$')
  INTO ok FROM (SELECT private.new_activation_code() AS c FROM generate_series(1, 300)) g;
  results := results || (CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' codes: LVL-XXXX-XXXX-XXXX Crockford base32, 300 distinct');
  SELECT count(DISTINCT ch) INTO n FROM (SELECT regexp_split_to_table(replace(substr(private.new_activation_code(), 5), '-', ''), '') AS ch FROM generate_series(1, 400)) g;
  results := results || (CASE WHEN n = 32 THEN 'PASS' ELSE 'FAIL ' || n END || ' codes: all 32 symbols drawn (5 bits x 12 = 60 bits)');
  results := results || (CASE WHEN private.normalize_activation_code(' lvl-abcd efgh_1234 ') = 'ABCDEFGH1234'
    AND private.normalize_activation_code('LVL-OOOO-IIII-LLLL') = '000011111111'
    AND private.normalize_activation_code('ABCDEFGH1234') = 'ABCDEFGH1234'
    AND private.normalize_activation_code('LVL-UUUU-AAAA-BBBB') IS NULL
    AND private.normalize_activation_code('LVL-ABCD') IS NULL
    AND private.normalize_activation_code(ws_a) IS NULL
    AND private.sha256_hex('ABCDEFGH1234') = 'ef8d2f565d2fb9dbd5afd366b69dc5c3c73b28fb434e1704a6660e9b61c648c3'
    THEN 'PASS' ELSE 'FAIL' END || ' normalisation (case, separators, O/I/L) and hash vector shared with the dashboard');

  -- Staff only.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_c, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.admin_create_activation_code(ws_a); results := results || 'FAIL client created a code'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS codes are staff only'::text; END;
  BEGIN PERFORM public.admin_set_site_owner_email(ws_a, 'client@zz-claim.test'); results := results || 'FAIL client set owner e-mail'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS owner e-mail is staff only'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated', 'email', 'staff@zz-claim.test')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.admin_create_activation_code(ws_a);
  code := j->>'code';
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN j->>'role' = 'owner'
    AND (SELECT code_hash FROM private.website_activation_codes WHERE id = (j->>'id')::uuid) = private.sha256_hex(private.normalize_activation_code(code))
    AND (SELECT code_hint FROM private.website_activation_codes WHERE id = (j->>'id')::uuid) = right(code, 4)
    AND NOT EXISTS (SELECT 1 FROM private.website_activation_codes k WHERE k.code_hash = code OR k.code_hint = code)
    AND NOT EXISTS (SELECT 1 FROM public.hq_audit_log l WHERE l.metadata::text LIKE '%' || substr(code, 5) || '%')
    AND (SELECT expires_at FROM private.website_activation_codes WHERE id = (j->>'id')::uuid) BETWEEN now() + interval '6 days 23 hours' AND now() + interval '7 days 1 minute'
    THEN 'PASS' ELSE 'FAIL' END || ' code returned once, only its hash stored, never logged, 7 days');

  -- Redeem.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_n, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.redeem_activation_code(code)->>'status' = 'email_unconfirmed' THEN 'PASS' ELSE 'FAIL' END || ' redeem: confirmed e-mail required');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_c, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.redeem_activation_code(ws_a)->>'status' = 'invalid'
    THEN 'PASS' ELSE 'FAIL' END || ' the website id is not a code');
  j := public.redeem_activation_code(lower(replace(code, '-', ' ')));
  results := results || (CASE WHEN j->>'status' = 'activated' AND j->>'website_id' = ws_a
    AND EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_a AND user_id = u_c AND role = 'owner')
    AND (SELECT status = 'approved' AND website_id = ws_a FROM public.access_requests WHERE user_id = u_c)
    THEN 'PASS' ELSE 'FAIL' END || ' redeem: owner of the bound website, request approved');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.redeem_activation_code(code)->>'status' = 'invalid' THEN 'PASS' ELSE 'FAIL' END || ' redeem: single use (same answer as unknown)');
  EXECUTE 'RESET ROLE';

  -- Expired, revoked, bound to an e-mail.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  code := public.admin_create_activation_code(ws_b, 'editor')->>'code';
  j := public.admin_create_activation_code(ws_b, 'viewer');
  code2 := j->>'code';
  PERFORM public.admin_revoke_activation_code((j->>'id')::uuid);
  EXECUTE 'RESET ROLE';
  UPDATE private.website_activation_codes SET expires_at = now() - interval '1 second'
  WHERE code_hash = private.sha256_hex(private.normalize_activation_code(code));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.redeem_activation_code(code)->>'status' = 'expired' THEN 'PASS' ELSE 'FAIL' END || ' redeem: expired code');
  results := results || (CASE WHEN public.redeem_activation_code(code2)->>'status' = 'invalid' THEN 'PASS' ELSE 'FAIL' END || ' redeem: revoked code');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  code := public.admin_create_activation_code(ws_c, 'admin', 'Bound@ZZ-claim.test')->>'code';
  j := public.admin_get_site_access(ws_b);
  results := results || (CASE WHEN jsonb_array_length(j->'codes') = 2
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'codes') c WHERE c->>'status' = 'expired')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'codes') c WHERE c->>'status' = 'revoked')
    AND NOT (j::text LIKE '%' || substr(code2, 5) || '%')
    THEN 'PASS' ELSE 'FAIL' END || ' staff list: statuses, never the code');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.redeem_activation_code(code)->>'status' = 'invalid' THEN 'PASS' ELSE 'FAIL' END || ' redeem: code bound to another e-mail refused (uniform answer)');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.redeem_activation_code(code);
  results := results || (CASE WHEN j->>'status' = 'activated'
    AND EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_c AND user_id = u_b AND role = 'admin')
    THEN 'PASS' ELSE 'FAIL' END || ' redeem: bound e-mail accepted with the code role');
  EXECUTE 'RESET ROLE';

  -- Brute force: 5 per hour per account, 5 per hour per client.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_r, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.redeem_activation_code('garbage')->>'status' = 'invalid' THEN 'PASS' ELSE 'FAIL' END || ' redeem: garbage is invalid');
  n := 1;
  BEGIN
    FOR i IN 1..8 LOOP
      PERFORM public.redeem_activation_code('LVL-AAAA-BBBB-CCC' || i);
      n := n + 1;
    END LOOP;
    results := results || 'FAIL redeem not rate limited'::text;
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    results := results || (CASE WHEN n = 5 THEN 'PASS' ELSE 'FAIL ' || n END || ' redeem: 5 attempts per hour per account');
  END;
  EXECUTE 'RESET ROLE';
  n := 0;
  BEGIN
    FOR i IN 1..8 LOOP
      u_cl := gen_random_uuid();
      INSERT INTO auth.users (id, email, aud, role, email_confirmed_at)
        VALUES (u_cl, 'bot' || i || '@zz-claim.test', 'authenticated', 'authenticated', now());
      PERFORM set_config('request.jwt.claims', json_build_object('sub', u_cl, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM public.redeem_activation_code('LVL-AAAA-BBBB-CCCC', repeat('ab', 32));
      EXECUTE 'RESET ROLE';
      n := n + 1;
    END LOOP;
    results := results || 'FAIL client (IP) not rate limited'::text;
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    EXECUTE 'RESET ROLE';
    results := results || (CASE WHEN n = 5 THEN 'PASS' ELSE 'FAIL ' || n END || ' redeem: 5 attempts per hour per client across accounts');
  END;
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'site.activation_code_failed' AND target_id = u_r::text)
    THEN 'PASS' ELSE 'FAIL' END || ' failed attempts audited');

  -- Owner e-mail: validation and uniqueness.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.admin_set_site_owner_email(ws_d, 'nope'); results := results || 'FAIL invalid owner e-mail'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'invalid_email' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' owner e-mail validated'); END;
  BEGIN PERFORM public.admin_set_site_owner_email(ws_owned, 'someone@zz-claim.test'); results := results || 'FAIL owned org claimable'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'organization_has_owner' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' organization with an owner refused'); END;
  j := public.admin_set_site_owner_email(ws_d, ' Claimer@ZZ-Claim.test ');
  results := results || (CASE WHEN j->>'owner_email' = 'claimer@zz-claim.test' THEN 'PASS' ELSE 'FAIL' END || ' owner e-mail stored lower-case');
  BEGIN PERFORM public.admin_set_site_owner_email(ws_e, 'claimer@zz-claim.test'); results := results || 'FAIL e-mail pending twice'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'email_pending_elsewhere' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' one pending claim per e-mail'); END;
  PERFORM public.admin_set_site_owner_email(ws_e, 'late@zz-claim.test');
  PERFORM public.admin_set_site_owner_email(ws_b, 'beowner@zz-claim.test');
  EXECUTE 'RESET ROLE';

  -- Not an exact match: nothing happens.
  u_cl := gen_random_uuid();
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES (u_cl, 'xclaimer@zz-claim.test', 'authenticated', 'authenticated', now());
  results := results || (CASE WHEN NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_d)
    THEN 'PASS' ELSE 'FAIL' END || ' auto-link: partial e-mail match ignored');
  -- Unconfirmed: nothing; confirmation links it, once.
  u_cl := gen_random_uuid();
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES (u_cl, 'CLAIMER@zz-claim.test', 'authenticated', 'authenticated', NULL);
  results := results || (CASE WHEN NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_d)
    THEN 'PASS' ELSE 'FAIL' END || ' auto-link: unconfirmed account not linked');
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = u_cl;
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_d AND user_id = u_cl AND role = 'owner')
    AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'site.owner_claimed' AND target_id = ws_d)
    THEN 'PASS' ELSE 'FAIL' END || ' auto-link: confirmed exact e-mail becomes owner, audited');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_cl, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.claim_site_ownership()->>'status' = 'none' THEN 'PASS' ELSE 'FAIL' END || ' auto-link: once only');
  EXECUTE 'RESET ROLE';
  -- An owner arrived meanwhile: nothing happens.
  INSERT INTO public.organization_members VALUES (org_e, u_o, 'owner');
  u_cl := gen_random_uuid();
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES (u_cl, 'late@zz-claim.test', 'authenticated', 'authenticated', now());
  results := results || (CASE WHEN NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_e AND user_id = u_cl)
    THEN 'PASS' ELSE 'FAIL' END || ' auto-link: organization that has an owner is never claimed');
  -- Existing confirmed account: linked at its next sign-in (claim_site_ownership).
  UPDATE auth.users SET email = 'beowner@zz-claim.test' WHERE id = u_x;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_b AND user_id = u_x AND role = 'owner')
    OR (public.claim_site_ownership()->>'status' = 'claimed'
        AND EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_b AND user_id = u_x AND role = 'owner'))
    THEN 'PASS' ELSE 'FAIL' END || ' auto-link: existing account linked after sign-in');
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO failed FROM unnest(results) r WHERE r LIKE 'FAIL%';
  RAISE EXCEPTION E'% failed\n%', failed, array_to_string(results, E'\n');
END;
$$;
