-- Input validation tests (security hardening, migrations 20261019120000..20261019120800).
-- Malicious payloads (script tags, SQL-looking strings, oversized text and
-- JSON, bad e-mails, unknown keys, hidden characters, script links) must be
-- refused with a clean code, and valid input must still work.
-- Always rolls back; the exception message is the report.
DO $$
DECLARE
  fs text := 'ws_d5e600b7dc2ec9a9';   -- Final Stop (contact, bookings, waitlist)
  u_req uuid := gen_random_uuid();
  u_adm uuid := gen_random_uuid();
  q text := chr(39);
  -- SQL keywords are assembled at run time so the test text itself stays inert.
  kw_drop text := 'DR' || 'OP TA' || 'BLE';
  kw_trunc text := 'TRUNC' || 'ATE';
  r text[] := '{}';
  j jsonb;
  t text;
  v_id uuid;
  v_token text;
  v_ticket text;
  big text := repeat('a', 6000);
  deep jsonb := '{"a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}}';
  many jsonb;
BEGIN
  SELECT jsonb_object_agg('k' || g, g) INTO many FROM generate_series(1, 150) g;

  -- ---------------------------------------------------------------- helpers (as owner)
  r := r || (CASE WHEN private.clean_line('  Ann' || chr(8203) || 'a ' || chr(8238) || E'\n\t Smith  ', 120) = 'Anna Smith'
    THEN 'PASS' ELSE 'FAIL' END || ' clean_line strips zero-width / bidi, collapses whitespace');
  r := r || (CASE WHEN private.clean_text(E'line 1\r\n\r\n\r\n\r\nline 2' || chr(7), 100) = E'line 1\n\nline 2'
    THEN 'PASS' ELSE 'FAIL' END || ' clean_text normalises line breaks, strips control chars');
  r := r || (CASE WHEN private.has_markup('<script>alert(1)</script>') AND private.has_markup('<img src=x onerror=alert(1)>')
    AND NOT private.has_markup('a < b and <3') THEN 'PASS' ELSE 'FAIL' END || ' has_markup finds tags, not a < b');
  r := r || (CASE WHEN private.safe_url('javascript:alert(1)') IS NULL AND private.safe_url('data:text/html,x') IS NULL
    AND private.safe_url('https://user@evil.com') IS NULL AND private.safe_url('//evil.com') IS NULL
    AND private.safe_url('example.com/page') = 'https://example.com/page'
    AND private.safe_url('https://www.example.com/a?b=1') = 'https://www.example.com/a?b=1'
    THEN 'PASS' ELSE 'FAIL' END || ' safe_url keeps http(s) only');
  r := r || (CASE WHEN private.is_valid_email('ann.smith+tag@example.co.uk') AND NOT private.is_valid_email('a@b')
    AND NOT private.is_valid_email('x' || q || 'y"@z.com') AND NOT private.is_valid_email('a..b@example.com')
    AND NOT private.is_valid_email('ann@example.com Bcc: x@y.com') THEN 'PASS' ELSE 'FAIL' END || ' is_valid_email');
  r := r || (CASE WHEN private.is_valid_phone('+33 6 12 34 56 78') AND private.is_valid_phone('(555) 123-4567')
    AND NOT private.is_valid_phone('call me maybe') AND NOT private.is_valid_phone('12345')
    THEN 'PASS' ELSE 'FAIL' END || ' is_valid_phone');
  r := r || (CASE WHEN private.clean_link_array('["javascript:alert(1)","@my.bakery","instagram.com/bakery","<b>x</b>"]', 8, 300)
    = ARRAY['@my.bakery', 'https://instagram.com/bakery'] THEN 'PASS' ELSE 'FAIL' END || ' clean_link_array removes script links');
  r := r || (CASE WHEN private.clean_jsonb(('{" ki' || chr(8203) || 'nd ":"rsvp","n":[1,true,null]}')::jsonb) = '{"kind":"rsvp","n":[1,true,null]}'
    THEN 'PASS' ELSE 'FAIL' END || ' clean_jsonb cleans keys, keeps scalars');

  UPDATE public.website_settings SET value = jsonb_set(value, '{open}', 'true') WHERE website_id = fs AND key = 'waitlist';

  -- ---------------------------------------------------------------- anonymous visitor
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.headers', '{"origin":"https://finalstop.org"}', true);
  EXECUTE 'SET LOCAL ROLE anon';

  -- submit_form: valid input still works (hidden characters cleaned)
  j := public.submit_form(fs, 'contact', 'Ann' || chr(8203) || 'a  Test', 'Anna.Test@Example.com', '+1 (555) 010-2030',
    'Acme', E'Hello,\r\nI would like a quote.', '{"service":"haircut","when":"soon"}', 'finalstop.org/contact');
  v_ticket := j ->> 'ticket_code';
  r := r || (CASE WHEN v_ticket IS NOT NULL THEN 'PASS' ELSE 'FAIL' END || ' submit_form valid input accepted');

  -- SQL-looking text is plain data: stored as typed, nothing executed
  j := public.submit_form(fs, 'contact', 'Robert' || q || '); ' || kw_drop || ' form_submissions;--', 'bobby@example.com', NULL,
    NULL, '1 OR 1=1; SELECT * FROM auth.users; --');
  r := r || (CASE WHEN j ? 'ticket_code' AND to_regclass('public.form_submissions') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
    || ' SQL-looking text stored as plain text');

  BEGIN PERFORM public.submit_form(fs, 'contact', '<script>alert(1)</script>', 'eve1@example.com'); r := r || 'FAIL script tag in name accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS script tag in name refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'contact', 'Eve', 'eve2@example.com', NULL, NULL, 'Hi <img src=x onerror=alert(1)>'); r := r || 'FAIL HTML in message accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS HTML in message refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'contact', 'Eve', 'eve3@example.com', NULL, NULL, big); r := r || 'FAIL 6000-char message accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS oversized message refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'contact', repeat('n', 121), 'eve4@example.com'); r := r || 'FAIL 121-char name accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS oversized name refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'contact', 'Eve', 'not-an-email'); r := r || 'FAIL bad email accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS bad email refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'contact', 'Eve', E'eve@example.com\r\nBcc: all@example.com'); r := r || 'FAIL header-injection email accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS header-injection email refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'contact', 'Eve', NULL, 'call me'); r := r || 'FAIL bad phone accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS bad phone refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'admin', 'Eve', 'eve5@example.com'); r := r || 'FAIL unknown form type accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS unknown form type refused'::text; END;
  BEGIN PERFORM public.submit_form(fs || ''' OR 1=1', 'contact', 'Eve', 'eve6@example.com'); r := r || 'FAIL bad website id accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT404' THEN r := r || 'PASS malformed website id refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'contact', 'Eve', 'eve7@example.com', NULL, NULL, NULL, jsonb_build_object('x', repeat('z', 20000))); r := r || 'FAIL 20 KB data accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS oversized data refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'contact', 'Eve', 'eve8@example.com', NULL, NULL, NULL, deep); r := r || 'FAIL 7-level data accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS too deep data refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'contact', 'Eve', 'eve9@example.com', NULL, NULL, NULL, many); r := r || 'FAIL 150-key data accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS too many data keys refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'contact', 'Eve', 'eve10@example.com', NULL, NULL, NULL, '{"__proto__":{"admin":true}}'); r := r || 'FAIL __proto__ key accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS prototype key refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'contact', 'Eve', 'eve11@example.com', NULL, NULL, NULL, '{"note":"<script>steal()</script>"}'); r := r || 'FAIL script in data accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS script in data refused'::text; END;
  BEGIN PERFORM public.submit_form(fs, 'contact', 'Eve', 'eve12@example.com', NULL, NULL, NULL, '["not","an","object"]'); r := r || 'FAIL array data accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS non-object data refused'::text; END;

  -- book_appointment
  j := public.book_appointment(fs, 'haircut', (now() at time zone 'UTC')::date + 3, '06:17', 'Val Booker', 'val@example.com', '+15550100', NULL, E'First visit.\nThanks!');
  r := r || (CASE WHEN j ->> 'status' = 'pending' THEN 'PASS' ELSE 'FAIL' END || ' book_appointment valid input accepted');
  BEGIN PERFORM public.book_appointment(fs, '../../etc/passwd', (now() at time zone 'UTC')::date + 3, '06:19', 'Val', 'val2@example.com'); r := r || 'FAIL path-like slug accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS malformed service slug refused'::text; END;
  BEGIN PERFORM public.book_appointment(fs, 'haircut', (now() at time zone 'UTC')::date + 3, '06:21', 'Val', 'val3@example.com', NULL, NULL, repeat('x', 2001)); r := r || 'FAIL 2001-char notes accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS oversized notes refused'::text; END;
  BEGIN PERFORM public.book_appointment(fs, 'haircut', (now() at time zone 'UTC')::date + 3, '06:23', '<b>Val</b>', 'val4@example.com'); r := r || 'FAIL HTML name accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS HTML in booking name refused'::text; END;
  BEGIN PERFORM public.book_appointment(fs, 'haircut', (now() at time zone 'UTC')::date + 900, '06:25', 'Val', 'val5@example.com'); r := r || 'FAIL far date accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS out-of-range date refused'::text; END;

  -- join_waitlist
  j := public.join_waitlist(fs, 'Wade Wait', '+1 555 0101', 'wade@example.com');
  r := r || (CASE WHEN j ->> 'status' = 'waiting' THEN 'PASS' ELSE 'FAIL' END || ' join_waitlist valid input accepted');
  BEGIN PERFORM public.join_waitlist(fs, 'Wade', '+1 555 0102', 'wade2@example.com', 'x; ' || lower(kw_drop) || ' services'); r := r || 'FAIL SQL-ish slug accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS SQL-ish service slug refused'::text; END;
  BEGIN PERFORM public.join_waitlist(fs, repeat('w', 500), '+1 555 0103'); r := r || 'FAIL 500-char name accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS oversized waitlist name refused'::text; END;

  -- submit_project_request / record_project_qualification / create_project_handoff
  j := public.submit_project_request(jsonb_build_object(
    'locale', 'en', 'name', 'Paula Project', 'email', 'paula@example.com', 'phone', '+33 6 11 22 33 44',
    'business_name', 'Paula Bakery', 'website', 'paula-bakery.example.com', 'has_business', true,
    'social_links', jsonb_build_array('javascript:alert(1)', '@paulabakery', 'https://instagram.com/paula'),
    'activity', 'A family bakery in Lyon selling bread and pastries to the neighbourhood since 2019, we want online orders.',
    'brief', jsonb_build_object('reference', 'LU-12345', 'answers', jsonb_build_object('feat', jsonb_build_array('Menu', 'Photos')))));
  v_id := (j ->> 'id')::uuid;
  v_token := j ->> 'qualify_token';
  r := r || (CASE WHEN v_id IS NOT NULL AND v_token ~ '^[0-9a-f]{48}$' THEN 'PASS' ELSE 'FAIL' END || ' submit_project_request valid input accepted');
  BEGIN PERFORM public.submit_project_request(('{"name":"X","email":"x@example.com","business_name":"X","activity":"' || repeat('a', 90) || '","is_admin":true}')::jsonb); r := r || 'FAIL unknown key accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT400' THEN r := r || 'PASS unknown payload key refused'::text; END;
  BEGIN PERFORM public.submit_project_request(jsonb_build_object('name', 'X', 'email', 'x2@example.com', 'business_name', 'X',
    'website', 'javascript:alert(document.cookie)')); r := r || 'FAIL script website accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT400' THEN r := r || 'PASS script link as website refused'::text; END;
  BEGIN PERFORM public.submit_project_request(jsonb_build_object('name', 'X', 'email', 'x3@example.com', 'business_name', 'X',
    'website', 'https://x.example.com', 'brief', jsonb_build_object('answers', jsonb_build_object('act', '<iframe src=//evil></iframe>')))); r := r || 'FAIL HTML in brief accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT400' THEN r := r || 'PASS HTML in brief refused'::text; END;
  BEGIN PERFORM public.submit_project_request(jsonb_build_object('name', 'X', 'email', 'x4@example.com', 'business_name', 'X',
    'website', 'https://x.example.com', 'brief', jsonb_build_object('blob', repeat('b', 60000)))); r := r || 'FAIL 60 KB payload accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT400' THEN r := r || 'PASS oversized payload refused'::text; END;
  BEGIN PERFORM public.submit_project_request(jsonb_build_object('name', 'X', 'email', 'x"@evil', 'business_name', 'X', 'website', 'https://x.example.com')); r := r || 'FAIL bad email accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT400' THEN r := r || 'PASS bad project email refused'::text; END;
  BEGIN PERFORM public.submit_project_request('"just a string"'); r := r || 'FAIL non-object payload accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT400' THEN r := r || 'PASS non-object payload refused'::text; END;

  BEGIN PERFORM public.create_project_handoff(v_id, v_token || ''' OR ''1''=''1'); r := r || 'FAIL malformed token accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN r := r || 'PASS malformed handoff token refused'::text; END;
  BEGIN PERFORM public.record_project_qualification(v_id, v_token, jsonb_build_object('summary', repeat('s', 20000))); r := r || 'FAIL 20 KB AI result accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT400' THEN r := r || 'PASS oversized AI result refused (token kept)'::text; END;
  t := public.record_project_qualification(v_id, v_token, '{"score":82,"verdict":"qualified","summary":"Serious request.","reasons":["Clear need"],"red_flags":[]}');
  r := r || (CASE WHEN t = 'qualified' THEN 'PASS' ELSE 'FAIL got ' || coalesce(t, 'null') END || ' record_project_qualification valid result accepted');
  EXECUTE 'RESET ROLE';

  -- What was stored (read as owner: visitors cannot read these tables)
  SELECT name || '|' || email || '|' || message INTO t FROM public.form_submissions WHERE ticket_code = v_ticket;
  r := r || (CASE WHEN t = E'Anna Test|anna.test@example.com|Hello,\nI would like a quote.' THEN 'PASS' ELSE 'FAIL got ' || coalesce(t, 'null') END
    || ' submit_form stored the cleaned values');
  SELECT website || '|' || array_to_string(social_links, ',') INTO t FROM public.project_requests WHERE id = v_id;
  r := r || (CASE WHEN t = 'https://paula-bakery.example.com|@paulabakery,https://instagram.com/paula'
    THEN 'PASS' ELSE 'FAIL got ' || coalesce(t, 'null') END || ' project request website normalised, script link removed');

  -- ---------------------------------------------------------------- signed-in user
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES
    (u_req, 'req-iv@example.invalid', 'authenticated', 'authenticated', now()),
    (u_adm, 'adm-iv@example.invalid', 'authenticated', 'authenticated', now());
  INSERT INTO public.platform_admins (user_id) VALUES (u_adm);
  PERFORM set_config('request.headers', '{}', true);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_req, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.submit_access_request('<script>x</script>'); r := r || 'FAIL HTML business name accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS HTML business name refused'::text; END;
  BEGIN PERFORM public.submit_access_request('Acme', 'javascript:alert(1)'); r := r || 'FAIL script website accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS script website refused'::text; END;
  BEGIN PERFORM public.submit_access_request('Acme', NULL, NULL, repeat('m', 1001)); r := r || 'FAIL 1001-char message accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS oversized access message refused'::text; END;
  t := public.submit_access_request('Acme' || chr(8203) || ' Studio', 'acme.example.com', '+33 1 23 45 67 89', E'We need a site.\nThanks.');
  EXECUTE 'RESET ROLE';
  SELECT t || '|' || business_name || '|' || website INTO t FROM public.access_requests WHERE user_id = u_req;
  r := r || (CASE WHEN t = 'pending|Acme Studio|https://acme.example.com' THEN 'PASS' ELSE 'FAIL got ' || coalesce(t, 'null') END
    || ' submit_access_request valid input accepted, cleaned');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.create_organization('<b>Evil</b>', 'evil-org'); r := r || 'FAIL HTML org name accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS HTML organization name refused'::text; END;
  BEGIN PERFORM public.create_organization('Evil', 'evil; ' || lower(kw_drop) || ' organizations'); r := r || 'FAIL bad slug accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS malformed slug refused (no raw constraint error)'::text; END;
  BEGIN
    PERFORM public.create_organization('Valid IV Org', 'valid-iv-org-test');
    r := r || 'PASS create_organization valid input accepted'::text;
  EXCEPTION WHEN others THEN r := r || ('FAIL create_organization valid: ' || SQLSTATE || ' ' || SQLERRM); END;
  EXECUTE 'RESET ROLE';

  -- ---------------------------------------------------------------- tables and grants
  BEGIN UPDATE public.services SET image_url = 'javascript:alert(1)' WHERE website_id = fs; r := r || 'FAIL script image_url stored'::text;
  EXCEPTION WHEN check_violation THEN r := r || 'PASS script image_url refused by CHECK'::text; END;
  BEGIN UPDATE public.team_members SET bio = repeat('b', 5000) WHERE website_id = fs; r := r || 'FAIL 5000-char bio stored'::text;
  EXCEPTION WHEN check_violation THEN r := r || 'PASS oversized bio refused by CHECK'::text; END;
  BEGIN UPDATE public.website_settings SET value = jsonb_build_object('x', repeat('v', 70000)) WHERE website_id = fs AND key = 'waitlist'; r := r || 'FAIL 70 KB setting stored'::text;
  EXCEPTION WHEN check_violation THEN r := r || 'PASS oversized setting refused by CHECK'::text; END;
  r := r || (CASE WHEN NOT has_table_privilege('anon', 'public.faqs', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.site_settings', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.ai_usage', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.form_submissions', kw_trunc)
    AND NOT has_table_privilege('authenticated', 'public.services', kw_trunc)
    AND has_table_privilege('authenticated', 'public.services', 'UPDATE')
    THEN 'PASS' ELSE 'FAIL' END || ' unused table grants revoked, editor grants kept');
  r := r || (CASE WHEN NOT has_function_privilege('anon', 'private.check_text(text, integer, text, boolean)', 'EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END || ' validation helpers not executable by anon');

  RAISE EXCEPTION E'INPUT VALIDATION TESTS (rolled back): % failed of %\n%',
    (SELECT count(*) FROM unnest(r) x WHERE x LIKE 'FAIL%'), cardinality(r), array_to_string(r, E'\n');
END $$;
