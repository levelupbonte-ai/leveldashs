-- Access request review (migrations access_review + admin_review_access_request).
-- Always rolls back; the exception message is the report and must show `0 failed`.
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE
  u_p uuid := gen_random_uuid();   -- LevelUp staff
  u_a uuid := gen_random_uuid();   -- applicant, confirmed, website matches site BP
  u_u uuid := gen_random_uuid();   -- applicant, e-mail not confirmed
  u_c uuid := gen_random_uuid();   -- applicant for a site that already has an owner
  u_o uuid := gen_random_uuid();   -- existing owner of org O
  u_x uuid := gen_random_uuid();   -- applicant, new client
  u_f uuid := gen_random_uuid();   -- applicant approved into an empty organization (fix)
  org_bp uuid; org_o uuid; org_arch uuid; org_empty uuid;
  ws_bp text; ws_o text; ws_arch text;
  n integer; n2 integer; j jsonb; s text;
  results text[] := '{}';
  failed integer;
BEGIN
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES
    (u_p, 'staff@zz-review.test', 'authenticated', 'authenticated', now()),
    (u_a, 'owner@zz-bp-test.com', 'authenticated', 'authenticated', now()),
    (u_u, 'unconfirmed@zz-review.test', 'authenticated', 'authenticated', NULL),
    (u_c, 'second@zz-review.test', 'authenticated', 'authenticated', now()),
    (u_o, 'existing@zz-review.test', 'authenticated', 'authenticated', now()),
    (u_x, 'new@zz-review.test', 'authenticated', 'authenticated', now()),
    (u_f, 'fix@zz-review.test', 'authenticated', 'authenticated', now());
  INSERT INTO public.platform_admins (user_id) VALUES (u_p);
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Black Pater', 'zz-review-bp') RETURNING id INTO org_bp;
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Owned', 'zz-review-owned') RETURNING id INTO org_o;
  INSERT INTO public.organizations (name, slug, status) VALUES ('Zz Archived', 'zz-review-arch', 'archived') RETURNING id INTO org_arch;
  INSERT INTO public.organizations (name, slug) VALUES ('Zz Empty', 'zz-review-empty') RETURNING id INTO org_empty;
  INSERT INTO public.websites (organization_id, name, primary_domain, status, allowed_origins)
    VALUES (org_bp, 'BP', 'zz-bp-test.com', 'active', ARRAY['https://zz-bp-test.com', 'https://www.zz-bp-test.com']) RETURNING id INTO ws_bp;
  INSERT INTO public.websites (organization_id, name, primary_domain, status) VALUES (org_o, 'Owned', 'zz-owned-test.com', 'active') RETURNING id INTO ws_o;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_arch, 'Arch', 'active') RETURNING id INTO ws_arch;
  INSERT INTO public.organization_members VALUES (org_o, u_o, 'owner'), (org_empty, u_f, 'owner');
  INSERT INTO public.access_requests (user_id, business_name, website) VALUES
    (u_a, 'Black_pater', 'https://www.ZZ-BP-Test.com/'), (u_u, 'Unconfirmed', NULL),
    (u_c, 'Second', NULL), (u_o, 'Existing', NULL), (u_x, 'Brand New Co', NULL);
  INSERT INTO public.access_requests (user_id, business_name, status, organization_id)
    VALUES (u_f, 'Empty Co', 'approved', org_empty);

  -- Host normalisation.
  results := results || (CASE WHEN private.url_host('https://www.ZZ-BP-Test.com/') = 'zz-bp-test.com'
    AND private.url_host('zz-bp-test.com') = 'zz-bp-test.com'
    AND private.url_host('http://u:p@www.x.co:8080/a?b#c') = 'x.co'
    AND private.url_host('WWW.Example.org.') = 'example.org'
    AND private.url_host('not a url') IS NULL AND private.url_host('') IS NULL
    AND private.email_domain('A@WWW.Ex.com') = 'ex.com'
    THEN 'PASS' ELSE 'FAIL' END || ' url_host / email_domain normalise scheme, www, port, path, case');

  -- Non-staff.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.admin_review_access_request(u_a, 'connect', ws_bp); results := results || 'FAIL applicant approved itself'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS non-staff refused'::text; END;
  BEGIN PERFORM public.admin_access_review_context(u_a); results := results || 'FAIL applicant read review context'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS review context is staff only'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated', 'email', 'staff@zz-review.test')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  j := public.admin_access_review_context(u_a);
  results := results || (CASE WHEN j->>'requested_host' = 'zz-bp-test.com' AND (j->>'email_confirmed')::boolean
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'websites') w WHERE w->>'id' = ws_bp AND (w->>'host_match')::boolean AND (w->>'email_match')::boolean AND (w->>'owners')::int = 0)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'websites') w WHERE w->>'id' = ws_arch)
    THEN 'PASS' ELSE 'FAIL' END || ' context: suggested site with host + e-mail hints, archived sites hidden');
  j := public.admin_list_access_requests();
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(j) r WHERE (r->>'user_id')::uuid = u_f AND (r->>'organization_websites')::int = 0)
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(j) r WHERE (r->>'user_id')::uuid = u_u AND NOT (r->>'email_confirmed')::boolean)
    THEN 'PASS' ELSE 'FAIL' END || ' list: confirmation flag and empty-organization count');

  BEGIN PERFORM public.admin_review_access_request(u_a, 'approve'); results := results || 'FAIL unknown mode accepted'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'invalid_mode' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' unknown mode refused'); END;
  BEGIN PERFORM public.admin_review_access_request(u_u, 'connect', ws_bp); results := results || 'FAIL unconfirmed approved'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'email_unconfirmed' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' unconfirmed e-mail refused'); END;
  BEGIN PERFORM public.admin_review_access_request(u_a, 'connect', NULL); results := results || 'FAIL missing site id'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'invalid_website_id' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' missing website id refused (no silent organization)'); END;
  BEGIN PERFORM public.admin_review_access_request(u_a, 'connect', 'ws_<script>'); results := results || 'FAIL bad site id'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'invalid_website_id' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' malformed website id refused'); END;
  BEGIN PERFORM public.admin_review_access_request(u_a, 'connect', 'ws_00000000zzzzzzzz'); results := results || 'FAIL unknown site'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'website_not_found' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' unknown website refused'); END;
  BEGIN PERFORM public.admin_review_access_request(u_a, 'connect', ws_arch); results := results || 'FAIL archived site'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'website_archived' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' archived website / organization refused'); END;
  BEGIN PERFORM public.admin_review_access_request(u_a, 'connect', ws_bp, 'superuser'); results := results || 'FAIL bad role'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'invalid_role' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' unknown role refused'); END;

  -- Black Pater case: connect, no new organization.
  SELECT count(*) INTO n FROM public.organizations;
  j := public.admin_review_access_request(u_a, 'connect', upper(ws_bp));
  SELECT count(*) INTO n2 FROM public.organizations;
  results := results || (CASE WHEN n = n2 AND j->>'role' = 'owner' AND (j->>'organization_id')::uuid = org_bp AND j->>'website_id' = ws_bp
    AND EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_bp AND user_id = u_a AND role = 'owner')
    AND (SELECT status = 'approved' AND website_id = ws_bp AND organization_id = org_bp FROM public.access_requests WHERE user_id = u_a)
    THEN 'PASS' ELSE 'FAIL' END || ' connect: owner of the existing organization, no new organization');
  EXECUTE 'RESET ROLE';
  results := results || (CASE WHEN EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'access_request.approved' AND target_id = u_a::text
    AND metadata->>'website_id' = ws_bp AND (metadata->>'host_match')::boolean AND actor_id = u_p)
    THEN 'PASS' ELSE 'FAIL' END || ' decision audited with hints and actor');
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.admin_review_access_request(u_a, 'connect', ws_bp);
  results := results || (CASE WHEN (j->>'unchanged')::boolean AND j->>'role' = 'owner' THEN 'PASS' ELSE 'FAIL' END || ' same decision twice is idempotent');

  -- Organization that already has an owner: second confirmation.
  BEGIN PERFORM public.admin_review_access_request(u_c, 'connect', ws_o); results := results || 'FAIL no confirmation'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'confirmation_required' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' existing owner: site id must be typed again'); END;
  BEGIN PERFORM public.admin_review_access_request(u_c, 'connect', ws_o, 'editor', ws_bp); results := results || 'FAIL wrong confirmation'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'confirmation_required' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' wrong confirmation refused'); END;
  j := public.admin_review_access_request(u_c, 'connect', ws_o, NULL, ws_o);
  results := results || (CASE WHEN j->>'role' = 'admin' THEN 'PASS' ELSE 'FAIL' END || ' default role is admin when an owner exists');

  BEGIN PERFORM public.admin_review_access_request(u_o, 'connect', ws_o, 'editor', ws_o); results := results || 'FAIL duplicate member'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'already_member' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' already-member duplicate refused'); END;

  -- Old signature: never creates an organization any more.
  BEGIN PERFORM public.review_access_request(u_x, true, NULL); results := results || 'FAIL legacy created an organization'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'choose_site_or_create' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' legacy approve without organization refuses'); END;

  -- Create a new client: explicit only, domain already used refused.
  BEGIN PERFORM public.admin_review_access_request(u_x, 'create', NULL, NULL, NULL, 'Brand New Co', NULL, 'https://www.zz-bp-test.com'); results := results || 'FAIL duplicate domain'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'domain_taken' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' create: a domain already used by a site is refused'); END;
  j := public.admin_review_access_request(u_x, 'create', NULL, 'viewer', NULL, 'Brand New Co', 'Brand New', 'brand-new-zz.test');
  results := results || (CASE WHEN j->>'role' = 'owner' AND j->>'website_domain' = 'brand-new-zz.test'
    AND (SELECT status FROM public.websites WHERE id = j->>'website_id') = 'draft'
    AND EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = (j->>'organization_id')::uuid AND user_id = u_x AND role = 'owner')
    THEN 'PASS' ELSE 'FAIL' END || ' create: organization + draft site, owner');
  BEGIN PERFORM public.admin_review_access_request(u_x, 'create'); results := results || 'FAIL created twice'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM IN ('already_approved', 'already_member') THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' create twice refused'); END;
  BEGIN PERFORM public.admin_review_access_request(u_a, 'connect', ws_o, 'viewer', ws_o); results := results || 'FAIL moved an approved client'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'already_approved' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' approved client with a website is not moved'); END;
  BEGIN PERFORM public.admin_review_access_request(u_a, 'reject'); results := results || 'FAIL rejected an approved request'::text;
  EXCEPTION WHEN OTHERS THEN results := results || (CASE WHEN SQLERRM = 'already_approved' THEN 'PASS' ELSE 'FAIL ' || SQLERRM END || ' approved request cannot be declined'); END;

  -- Fix ("moni"): approved into an empty organization, reconnected, empty org archived.
  j := public.admin_review_access_request(u_f, 'connect', ws_bp, 'editor', ws_bp);
  results := results || (CASE WHEN (j->>'archived_organization_id')::uuid = org_empty
    AND (SELECT status FROM public.organizations WHERE id = org_empty) = 'archived'
    AND EXISTS (SELECT 1 FROM public.organizations WHERE id = org_empty)
    AND EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_bp AND user_id = u_f AND role = 'editor')
    THEN 'PASS' ELSE 'FAIL' END || ' fix: reconnected, empty organization archived (kept)');

  -- Decline + legacy decline.
  j := public.review_access_request(u_u, false);
  results := results || (CASE WHEN j->>'status' = 'rejected' AND (SELECT status FROM public.access_requests WHERE user_id = u_u) = 'rejected'
    THEN 'PASS' ELSE 'FAIL' END || ' legacy decline delegates');
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO failed FROM unnest(results) r WHERE r LIKE 'FAIL%';
  RAISE EXCEPTION E'% failed\n%', failed, array_to_string(results, E'\n');
END;
$$;
