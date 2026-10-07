-- Public RPC + content RLS tests for website_content. Always rolls back; the
-- exception message is the report. Avoids DELETE statements on purpose.
SET LOCAL statement_timeout = '20s';
DO $$
DECLARE
  u_a uuid := gen_random_uuid(); u_b uuid := gen_random_uuid();
  org_a uuid; org_b uuid; ws_a text; ws_b text; n integer; j jsonb; t text;
  results text[] := '{}';
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES (u_a,'a@t.l','authenticated','authenticated'),(u_b,'b@t.l','authenticated','authenticated');
  INSERT INTO public.organizations (name, slug) VALUES ('Org A','org-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('Org B','org-b') RETURNING id INTO org_b;
  INSERT INTO public.organization_members VALUES (org_a, u_a, 'owner'), (org_b, u_b, 'owner');
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'Site A', 'active') RETURNING id INTO ws_a;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_b, 'Site B', 'active') RETURNING id INTO ws_b;
  INSERT INTO public.website_features (website_id, organization_id, feature_key) VALUES (ws_a, org_a, 'bookings'), (ws_a, org_a, 'waitlist'), (ws_a, org_a, 'contact_form');
  INSERT INTO public.website_settings (website_id, organization_id, key, value) VALUES (ws_a, org_a, 'tickets', '{"prefix":"fs"}'), (ws_a, org_a, 'waitlist', '{"open":true,"minutes_per_client":25}');
  INSERT INTO public.team_members (website_id, organization_id, slug, name) VALUES (ws_a, org_a, 'mika', 'Mika');
  INSERT INTO public.services (website_id, organization_id, slug, name, price_label, price_cents) VALUES (ws_a, org_a, 'haircut', 'Haircut', '$40', 4000);
  INSERT INTO public.services (website_id, organization_id, slug, name, status) VALUES (ws_a, org_a, 'secret', 'Draft svc', 'draft');
  INSERT INTO public.services (website_id, organization_id, slug, name) VALUES (ws_b, org_b, 'b-svc', 'B service');

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO n FROM public.services WHERE website_id = ws_a;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' anon sees only published services');
  BEGIN PERFORM count(*) FROM public.appointments; results := results || 'FAIL anon read appointments'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS anon cannot read appointments'::text; END;
  BEGIN INSERT INTO public.services (website_id, organization_id, slug, name) VALUES (ws_a, org_a, 'x', 'x'); results := results || 'FAIL anon insert'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS anon cannot write content'::text; END;
  j := public.book_appointment(ws_a, 'haircut', current_date + 2, '10:00', 'John Doe', 'john@x.com', NULL, 'mika');
  results := results || (CASE WHEN j->>'ticket_code' ~ '^FS-[A-Z0-9]{8}$' AND j->>'price_label' = '$40' THEN 'PASS' ELSE 'FAIL' END || ' booking uses server-side price');
  t := j->>'ticket_code';
  BEGIN PERFORM public.book_appointment(ws_a, 'haircut', current_date + 2, '10:00', 'Jane', 'jane@x.com', NULL, 'mika'); results := results || 'FAIL double booking'::text;
  EXCEPTION WHEN SQLSTATE 'PT409' THEN results := results || 'PASS slot conflict -> 409'::text; END;
  BEGIN PERFORM public.book_appointment(ws_a, 'secret', current_date + 3, '11:00', 'Jane', 'jane@x.com'); results := results || 'FAIL booked draft'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN results := results || 'PASS draft service not bookable'::text; END;
  BEGIN PERFORM public.book_appointment(ws_b, 'b-svc', current_date + 3, '11:00', 'Jane', 'jane@x.com'); results := results || 'FAIL feature gate'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS booking blocked when feature disabled'::text; END;
  j := public.get_ticket_status(ws_a, lower(t));
  results := results || (CASE WHEN j->>'status' = 'pending' AND j->>'first_name' = 'John' AND NOT j ? 'customer_email' THEN 'PASS' ELSE 'FAIL' END || ' ticket lookup without PII');
  results := results || (CASE WHEN public.get_ticket_status(ws_b, t) IS NULL THEN 'PASS' ELSE 'FAIL' END || ' ticket not visible from other site');
  PERFORM public.join_waitlist(ws_a, 'Alice Martin', '6195551234', NULL, 'haircut', 'mika');
  j := public.join_waitlist(ws_a, 'Bob Stone', '6195550000');
  results := results || (CASE WHEN (j->>'position')::int = 2 AND (j->>'est_minutes')::int = 25 THEN 'PASS' ELSE 'FAIL' END || ' waitlist position/eta');
  j := public.get_public_waitlist(ws_a);
  results := results || (CASE WHEN jsonb_array_length(j) = 2 AND j->0->>'display_name' = 'Alice M.' THEN 'PASS' ELSE 'FAIL' END || ' public waitlist masked');
  FOR i IN 1..5 LOOP PERFORM public.submit_form(ws_a, 'contact', 'Carl', 'carl@x.com'); END LOOP;
  BEGIN PERFORM public.submit_form(ws_a, 'contact', 'Carl', 'carl@x.com'); results := results || 'FAIL no rate limit'::text;
  EXCEPTION WHEN SQLSTATE 'PT429' THEN results := results || 'PASS 6th submission per hour rate limited'::text; END;
  BEGIN PERFORM public.submit_form(ws_a, 'quote', 'Dan', 'dan@x.com'); results := results || 'FAIL quote feature gate'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN results := results || 'PASS quote blocked (feature off)'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT (SELECT count(*) FROM public.appointments) + (SELECT count(*) FROM public.waitlist_entries) + (SELECT count(*) FROM public.form_submissions) INTO n;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' org B cannot see org A customers');
  UPDATE public.services SET name = 'hacked' WHERE website_id = ws_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' org B cannot edit org A services');
  BEGIN INSERT INTO public.services (website_id, organization_id, slug, name) VALUES (ws_a, org_b, 'x', 'x'); results := results || 'FAIL cross-tenant insert'::text;
  EXCEPTION WHEN foreign_key_violation OR insufficient_privilege THEN results := results || 'PASS cross-tenant insert blocked'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.appointments SET status = 'confirmed' WHERE ticket_code = t;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' owner confirms booking');
  BEGIN UPDATE public.appointments SET customer_email = 'x@y.z' WHERE ticket_code = t; results := results || 'FAIL edited customer data'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS customer-submitted fields immutable'::text; END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION E'CONTENT TESTS (rolled back): % failed\n%', (SELECT count(*) FROM unnest(results) r WHERE r LIKE 'FAIL%'), array_to_string(results, E'\n');
END;
$$;
