-- Team invitations with e-mailed single-use links (migration team_invitation_emails).
-- Always rolls back; the exception message is the report and must show `0 failed`.
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE
  u_o uuid := gen_random_uuid();   -- owner of org A
  u_e uuid := gen_random_uuid();   -- editor of org A
  u_i uuid := gen_random_uuid();   -- invitee with an existing, confirmed account
  u_x uuid := gen_random_uuid();   -- someone else
  u_n uuid := gen_random_uuid();   -- unconfirmed account
  u_late uuid := gen_random_uuid();
  org_a uuid;
  j jsonb; tok text; tok2 text; inv uuid; inv2 uuid; n integer; s text;
  results text[] := '{}';
  failed integer;
BEGIN
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES
    (u_o, 'owner@zz-inv.test', 'authenticated', 'authenticated', now()),
    (u_e, 'editor@zz-inv.test', 'authenticated', 'authenticated', now()),
    (u_i, 'invitee@zz-inv.test', 'authenticated', 'authenticated', now()),
    (u_x, 'other@zz-inv.test', 'authenticated', 'authenticated', now()),
    (u_n, 'unconfirmed@zz-inv.test', 'authenticated', 'authenticated', NULL);
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Invite Org', 'zz-inv-a') RETURNING id INTO org_a;
  INSERT INTO public.organization_members VALUES (org_a, u_o, 'owner'), (org_a, u_e, 'editor');

  results := results || (CASE WHEN private.sha256_hex('abc') = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    THEN 'PASS' ELSE 'FAIL' END || ' sha256_hex matches the dashboard (known vector)');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.create_organization_invitation(org_a, 'x@zz-inv.test', 'viewer'); results := results || 'FAIL editor invited'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS editors cannot invite'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated', 'email', 'owner@zz-inv.test')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.create_organization_invitation(org_a, 'not-an-email', 'viewer'); results := results || 'FAIL bad e-mail'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'invalid_email' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' invalid e-mail refused'); END;
  BEGIN PERFORM public.create_organization_invitation(org_a, 'Editor@ZZ-inv.test', 'viewer'); results := results || 'FAIL member invited'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'already_member' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' existing member refused'); END;

  j := public.create_organization_invitation(org_a, ' Invitee@ZZ-INV.test ', 'editor');
  tok := j->>'token'; inv := (j->>'invitation_id')::uuid;
  results := results || (CASE WHEN tok ~ '^[A-Za-z0-9_-]{43}$' AND j->>'email' = 'invitee@zz-inv.test' AND j->>'organization_name' = 'Zz Invite Org'
    AND (j->>'expires_at')::timestamptz BETWEEN now() + interval '6 days 23 hours' AND now() + interval '7 days 1 minute'
    THEN 'PASS' ELSE 'FAIL' END || ' invitation: 43-char token, e-mail normalised, 7-day expiry');
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN (SELECT token_hash FROM private.organization_invitation_tokens WHERE invitation_id = inv) = private.sha256_hex(tok)
    AND NOT EXISTS (SELECT 1 FROM private.organization_invitation_tokens WHERE token_hash = tok)
    THEN 'PASS' ELSE 'FAIL' END || ' only the SHA-256 of the token is stored');
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'team.invitation_created' AND target_id = org_a::text AND metadata->>'email' = 'invitee@zz-inv.test')
    THEN 'PASS' ELSE 'FAIL' END || ' invitation audited');

  -- Preview with the link only (anon).
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.get_organization_invitation(tok);
  results := results || (CASE WHEN j->>'status' = 'valid' AND j->>'email' = 'invitee@zz-inv.test' AND j->>'role' = 'editor' AND NOT j ? 'token'
    THEN 'PASS' ELSE 'FAIL' END || ' preview: valid, invited e-mail and role, no token echoed');
  results := results || (CASE WHEN public.get_organization_invitation('short')->>'status' = 'invalid'
    AND public.get_organization_invitation(repeat('A', 43))->>'status' = 'invalid'
    THEN 'PASS' ELSE 'FAIL' END || ' preview: malformed and unknown tokens are invalid');
  EXECUTE 'RESET ROLE';

  -- Accept: confirmed e-mail, same address, single use.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_n, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.accept_organization_invitation(tok)->>'status' = 'email_unconfirmed' THEN 'PASS' ELSE 'FAIL' END || ' accept: unconfirmed account refused');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.accept_organization_invitation(tok);
  results := results || (CASE WHEN j->>'status' = 'email_mismatch' AND j->>'invited_email' = 'invitee@zz-inv.test' THEN 'PASS' ELSE 'FAIL' END || ' accept: other e-mail refused');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_i, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.accept_organization_invitation(tok);
  results := results || (CASE WHEN j->>'status' = 'accepted' AND NOT (j->>'already')::boolean
    AND EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_a AND user_id = u_i AND role = 'editor')
    THEN 'PASS' ELSE 'FAIL' END || ' accept: membership created with the invited role');
  results := results || (CASE WHEN (public.accept_organization_invitation(tok)->>'already')::boolean THEN 'PASS' ELSE 'FAIL' END || ' accept twice by the same account: idempotent');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.accept_organization_invitation(tok)->>'status' = 'used' THEN 'PASS' ELSE 'FAIL' END || ' accepted link is single-use');
  EXECUTE 'RESET ROLE';

  -- Re-send: new token, old link dead, rate limited.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.create_organization_invitation(org_a, 'new@zz-inv.test', 'viewer');
  tok := j->>'token'; inv2 := (j->>'invitation_id')::uuid;
  PERFORM public.record_organization_invitation_email(inv2, false);
  results := results || (CASE WHEN (SELECT email_status FROM public.organization_invitations WHERE id = inv2) = 'failed' THEN 'PASS' ELSE 'FAIL' END || ' failed e-mail recorded as failed');
  j := public.resend_organization_invitation(inv2);
  tok2 := j->>'token';
  PERFORM public.record_organization_invitation_email(inv2, true);
  results := results || (CASE WHEN tok2 <> tok AND public.get_organization_invitation(tok)->>'status' = 'invalid'
    AND public.get_organization_invitation(tok2)->>'status' = 'valid'
    AND (SELECT email_status = 'sent' AND send_count = 1 FROM public.organization_invitations WHERE id = inv2)
    THEN 'PASS' ELSE 'FAIL' END || ' re-send: new token, previous link invalid, status sent');
  BEGIN PERFORM public.resend_organization_invitation(inv2); results := results || 'FAIL re-send not limited'::text;
  EXCEPTION WHEN SQLSTATE 'PT429' THEN results := results || 'PASS re-send rate limited (2 minutes)'::text; END;

  -- Expired link.
  EXECUTE 'RESET ROLE';
  UPDATE private.organization_invitation_tokens SET expires_at = now() - interval '1 second' WHERE invitation_id = inv2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN public.get_organization_invitation(tok2)->>'status' = 'expired'
    AND public.accept_organization_invitation(tok2)->>'status' = 'expired'
    THEN 'PASS' ELSE 'FAIL' END || ' expired link refused');
  EXECUTE 'RESET ROLE';

  -- Revoke: link dead, no join on e-mail confirmation.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.create_organization_invitation(org_a, 'late@zz-inv.test', 'viewer');
  tok := j->>'token';
  PERFORM public.revoke_organization_invitation((j->>'invitation_id')::uuid);
  results := results || (CASE WHEN public.get_organization_invitation(tok)->>'status' = 'revoked' THEN 'PASS' ELSE 'FAIL' END || ' revoked link refused');
  EXECUTE 'RESET ROLE';
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES (u_late, 'late@zz-inv.test', 'authenticated', 'authenticated', now());
  results := results || (CASE WHEN NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_a AND user_id = u_late)
    THEN 'PASS' ELSE 'FAIL' END || ' revoked invitation not joined on e-mail confirmation');

  -- Join on confirmation still works for live invitations.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.create_organization_invitation(org_a, 'fresh@zz-inv.test', 'editor');
  tok := j->>'token';
  EXECUTE 'RESET ROLE';
  u_late := gen_random_uuid();
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES (u_late, 'fresh@zz-inv.test', 'authenticated', 'authenticated', now());
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_late, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_a AND user_id = u_late)
    AND (public.accept_organization_invitation(tok)->>'already')::boolean
    THEN 'PASS' ELSE 'FAIL' END || ' new account joins on confirmation, link then reports accepted');
  EXECUTE 'RESET ROLE';

  -- 20 invitations per organization per day.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  n := 0;
  BEGIN
    FOR i IN 1..25 LOOP
      PERFORM public.create_organization_invitation(org_a, 'bulk' || i || '@zz-inv.test', 'viewer');
      n := n + 1;
    END LOOP;
    results := results || 'FAIL invitations not rate limited'::text;
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    results := results || (CASE WHEN n BETWEEN 1 AND 20 THEN 'PASS' ELSE 'FAIL' END || ' invitations rate limited per organization per day');
  END;
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO failed FROM unnest(results) r WHERE r LIKE 'FAIL%';
  RAISE EXCEPTION E'% failed\n%', failed, array_to_string(results, E'\n');
END;
$$;
