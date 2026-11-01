-- Email campaigns. Always rolls back (RAISE EXCEPTION at the end); the exception
-- message is the report and must show "0 failed".
--
-- Covers: newsletter sync, isolation between organizations, viewers masked,
-- viewers and editors cannot send / schedule / import / export, content checks
-- (no HTML, http(s) button only), the postal address required before the first
-- send, unsubscribed / bounced / complained contacts never selected (snapshot
-- and claim), the plan quota and the daily cap, the unsubscribe token (once,
-- only its own contact), the worker key, delivery events and the automatic
-- pause, imports with recorded consent, audit log, billing usage.
DO $$
DECLARE
  u_a uuid := gen_random_uuid();   -- owner of org A
  u_d uuid := gen_random_uuid();   -- admin of org A
  u_e uuid := gen_random_uuid();   -- editor of org A
  u_v uuid := gen_random_uuid();   -- viewer of org A
  u_b uuid := gen_random_uuid();   -- owner of org B
  u_s uuid := gen_random_uuid();   -- LevelUp staff
  org_a uuid; org_b uuid; ws_a text; ws_b text;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid;
  camp uuid; camp2 uuid; camp_b uuid;
  j jsonb; n int; t text; tok1 text; tok2 text; wkey text; r text[] := '{}';
  v_batch int; rid bigint;
  claims_a text; claims_d text; claims_e text; claims_v text; claims_b text; claims_s text;
  content jsonb := jsonb_build_object('template', 'newsletter', 'locale', 'en', 'subject', 'Autumn news',
    'preview_text', 'What is new', 'heading', 'Hello', 'body', E'First paragraph with **bold**.\n\nSee [our site](https://example.com).',
    'button_label', 'Book now', 'button_url', 'https://example.com/book');
BEGIN
  claims_a := json_build_object('sub', u_a, 'role', 'authenticated')::text;
  claims_d := json_build_object('sub', u_d, 'role', 'authenticated')::text;
  claims_e := json_build_object('sub', u_e, 'role', 'authenticated')::text;
  claims_v := json_build_object('sub', u_v, 'role', 'authenticated')::text;
  claims_b := json_build_object('sub', u_b, 'role', 'authenticated')::text;
  claims_s := json_build_object('sub', u_s, 'role', 'authenticated', 'aal', 'aal2')::text;

  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at) VALUES
    (u_a, 'mail-a@example.invalid', 'authenticated', 'authenticated', now()),
    (u_d, 'mail-d@example.invalid', 'authenticated', 'authenticated', now()),
    (u_e, 'mail-e@example.invalid', 'authenticated', 'authenticated', now()),
    (u_v, 'mail-v@example.invalid', 'authenticated', 'authenticated', now()),
    (u_b, 'mail-b@example.invalid', 'authenticated', 'authenticated', now()),
    (u_s, 'mail-s@example.invalid', 'authenticated', 'authenticated', now());
  INSERT INTO public.platform_admins (user_id) VALUES (u_s);
  INSERT INTO public.organizations (name, slug) VALUES ('Mail A', 'mail-test-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('Mail B', 'mail-test-b') RETURNING id INTO org_b;
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
    (org_a, u_a, 'owner'), (org_a, u_d, 'admin'), (org_a, u_e, 'editor'), (org_a, u_v, 'viewer'), (org_b, u_b, 'owner');
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'Mail site A', 'active') RETURNING id INTO ws_a;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_b, 'Mail site B', 'active') RETURNING id INTO ws_b;
  -- A test plan with a tiny e-mail quota.
  INSERT INTO public.plans (key, name, limits, active, is_default, sort_order)
  VALUES ('mail_test_plan', 'Mail test', '{"emails_month": 4}', true, false, 99);
  INSERT INTO public.organization_billing (organization_id, plan_key) VALUES (org_a, 'mail_test_plan');

  -- ---------- billing ----------
  r := r || (CASE WHEN 'emails_month' = ANY (private.billing_limit_keys()) THEN 'PASS' ELSE 'FAIL' END || ' emails_month is a plan limit key');
  r := r || (CASE WHEN (SELECT limits ->> 'emails_month' FROM public.plans WHERE key = 'free') = '500'
    AND (SELECT limits ->> 'emails_month' FROM public.plans WHERE key = 'business') = '50000'
    THEN 'PASS' ELSE 'FAIL' END || ' default quotas seeded (free 500, business 50000)');

  -- ---------- newsletter sync ----------
  INSERT INTO public.form_submissions (website_id, organization_id, form_type, ticket_code, name, email) VALUES
    (ws_a, org_a, 'newsletter', 'MT-0001', 'Ann One', 'Ann.One@Example.com'),
    (ws_a, org_a, 'newsletter', 'MT-0002', NULL, 'bob@example.com'),
    (ws_a, org_a, 'newsletter', 'MT-0003', 'Cid', 'cid@example.com'),
    (ws_a, org_a, 'newsletter', 'MT-0004', 'Dee', 'dee@example.com'),
    (ws_a, org_a, 'newsletter', 'MT-0005', 'Eve', 'eve@example.com'),
    (ws_a, org_a, 'contact', 'MT-0006', 'Not a subscriber', 'contact-only@example.com'),
    (ws_b, org_b, 'newsletter', 'MT-0007', 'B person', 'b-person@example.com');
  SELECT count(*) INTO n FROM public.email_contacts WHERE website_id = ws_a;
  r := r || (CASE WHEN n = 5 THEN 'PASS' ELSE 'FAIL ' || n END || ' newsletter sign-ups become contacts, contact form does not');
  SELECT id INTO c1 FROM public.email_contacts WHERE website_id = ws_a AND email = 'ann.one@example.com';
  SELECT id INTO c2 FROM public.email_contacts WHERE website_id = ws_a AND email = 'bob@example.com';
  SELECT id INTO c3 FROM public.email_contacts WHERE website_id = ws_a AND email = 'cid@example.com';
  SELECT id INTO c4 FROM public.email_contacts WHERE website_id = ws_a AND email = 'dee@example.com';
  SELECT id INTO c5 FROM public.email_contacts WHERE website_id = ws_a AND email = 'eve@example.com';
  r := r || (CASE WHEN c1 IS NOT NULL AND (SELECT source = 'newsletter' AND consent_source LIKE 'form:newsletter:%'
      AND status = 'subscribed' AND unsubscribe_token_hash ~ '^[0-9a-f]{64}$' FROM public.email_contacts WHERE id = c1)
    THEN 'PASS' ELSE 'FAIL' END || ' contact stores source, consent and a hashed token (address lower-cased)');
  tok1 := private.email_token(c1, 1);
  tok2 := private.email_token(c2, 1);
  r := r || (CASE WHEN tok1 ~ '^[A-Za-z0-9_-]{43}$' AND tok1 <> tok2
    AND NOT EXISTS (SELECT 1 FROM public.email_contacts WHERE unsubscribe_token_hash = tok1)
    THEN 'PASS' ELSE 'FAIL' END || ' tokens are 43-char, distinct, never stored in clear');

  -- ---------- isolation ----------
  PERFORM set_config('request.jwt.claims', claims_b, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.email_contacts_list(ws_a); r := r || 'FAIL org B lists org A contacts'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS org B cannot list org A contacts'::text; END;
  BEGIN PERFORM public.email_overview(ws_a); r := r || 'FAIL org B reads org A overview'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS org B cannot read org A overview'::text; END;
  BEGIN PERFORM public.email_campaign_save(ws_a, NULL, content); r := r || 'FAIL org B drafts on org A'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS org B cannot draft on org A'::text; END;
  BEGIN SELECT count(*) INTO n FROM public.email_contacts; r := r || 'FAIL contacts table readable'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS contacts table not readable directly'::text; END;
  BEGIN SELECT count(*) INTO n FROM public.email_campaign_recipients; r := r || 'FAIL recipients table readable'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS recipients table not readable directly'::text; END;
  j := public.email_campaign_save(ws_b, NULL, content);
  camp_b := (j ->> 'id')::uuid;
  EXECUTE 'RESET ROLE';

  -- ---------- viewer ----------
  PERFORM set_config('request.jwt.claims', claims_v, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.email_contacts_list(ws_a);
  r := r || (CASE WHEN NOT (j ->> 'pii')::boolean AND (j ->> 'total')::int = 5 AND j::text NOT LIKE '%ann.one@example.com%'
    AND j::text LIKE '%a***@e***.com%' THEN 'PASS' ELSE 'FAIL ' || left(j::text, 200) END || ' viewer sees contacts masked');
  j := public.email_contacts_list(ws_a, 'ann');
  r := r || (CASE WHEN (j ->> 'total')::int = 5 THEN 'PASS' ELSE 'FAIL ' || (j ->> 'total') END || ' viewer search ignored (no address probing)');
  BEGIN PERFORM public.email_campaign_save(ws_a, NULL, content); r := r || 'FAIL viewer drafted'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS viewer cannot draft'::text; END;
  BEGIN PERFORM public.email_campaign_get(camp_b); r := r || 'FAIL viewer A reads campaign B'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS org A cannot read org B campaign'::text; END;
  EXECUTE 'RESET ROLE';

  -- ---------- editor ----------
  PERFORM set_config('request.jwt.claims', claims_e, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.email_campaign_save(ws_a, NULL, content);
  camp := (j ->> 'id')::uuid;
  r := r || (CASE WHEN j ->> 'status' = 'draft' AND j ->> 'subject' = 'Autumn news' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' editor creates a draft');
  j := public.email_contacts_list(ws_a, 'ann');
  r := r || (CASE WHEN (j ->> 'pii')::boolean AND (j ->> 'total')::int = 1 THEN 'PASS' ELSE 'FAIL ' || left(j::text, 200) END || ' editor sees and searches addresses');
  BEGIN PERFORM public.email_campaign_save(ws_a, camp, content || '{"body": "<script>alert(1)</script>"}'); r := r || 'FAIL HTML body accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS HTML in the body refused'::text; END;
  BEGIN PERFORM public.email_campaign_save(ws_a, camp, content || '{"heading": "<img src=x onerror=alert(1)>"}'); r := r || 'FAIL HTML heading accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS HTML in the heading refused'::text; END;
  BEGIN PERFORM public.email_campaign_save(ws_a, camp, content || '{"button_url": "javascript:alert(1)"}'); r := r || 'FAIL javascript: button accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS javascript: button link refused'::text; END;
  BEGIN PERFORM public.email_campaign_save(ws_a, camp, content || '{"button_url": null}'); r := r || 'FAIL button without link accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS button label without link refused'::text; END;
  BEGIN PERFORM public.email_campaign_save(ws_a, camp, content || jsonb_build_object('subject', repeat('x', 121))); r := r || 'FAIL 121-char subject accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS subject over 120 characters refused'::text; END;
  BEGIN PERFORM public.email_campaign_save(ws_a, camp, content || '{"is_admin": true}'); r := r || 'FAIL unknown key accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS unknown key refused'::text; END;
  BEGIN PERFORM public.email_campaign_save(ws_a, camp, content || jsonb_build_object('image_media_id', gen_random_uuid())); r := r || 'FAIL foreign image accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS image outside the media library refused'::text; END;
  BEGIN PERFORM public.email_campaign_send(camp); r := r || 'FAIL editor sent'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS editor cannot send'::text; END;
  BEGIN PERFORM public.email_campaign_schedule(camp, now() + interval '1 day'); r := r || 'FAIL editor scheduled'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS editor cannot schedule'::text; END;
  BEGIN PERFORM public.email_campaign_claim(camp); r := r || 'FAIL editor claimed a batch'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS editor cannot claim recipients'::text; END;
  BEGIN PERFORM public.email_contacts_export(ws_a); r := r || 'FAIL editor exported'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS editor cannot export'::text; END;
  BEGIN PERFORM public.email_contacts_import(ws_a, '[{"email": "x@example.com"}]', true, 'Every contact agreed to receive e-mails.'); r := r || 'FAIL editor imported'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS editor cannot import'::text; END;
  BEGIN PERFORM public.email_save_sender(ws_a, 'Mail A', 'hello@example.com', '1 Main Street, San Diego, CA 92101'); r := r || 'FAIL editor saved sender'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS editor cannot change sender details'::text; END;
  BEGIN PERFORM public.email_campaign_test(camp); r := r || 'FAIL test sent without postal address'::text;
  EXCEPTION WHEN SQLSTATE 'PT412' THEN r := r || 'PASS test refused until the postal address is set'::text; END;
  EXECUTE 'RESET ROLE';

  -- viewer cannot send either
  PERFORM set_config('request.jwt.claims', claims_v, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.email_campaign_send(camp); r := r || 'FAIL viewer sent'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS viewer cannot send'::text; END;
  BEGIN PERFORM public.email_campaign_test(camp); r := r || 'FAIL viewer test-sent'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS viewer cannot send a test'::text; END;
  EXECUTE 'RESET ROLE';

  -- ---------- owner: sender details, then send ----------
  PERFORM set_config('request.jwt.claims', claims_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.email_campaign_send(camp); r := r || 'FAIL sent without postal address'::text;
  EXCEPTION WHEN SQLSTATE 'PT412' THEN r := r || 'PASS first send refused until the postal address is set'::text; END;
  BEGIN PERFORM public.email_save_sender(ws_a, 'Mail A', 'not-an-email', '1 Main Street, San Diego, CA 92101'); r := r || 'FAIL bad reply-to accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS invalid reply-to refused'::text; END;
  BEGIN PERFORM public.email_save_sender(ws_a, 'Mail A', 'hello@example.com', ''); r := r || 'FAIL empty address accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS empty postal address refused'::text; END;
  BEGIN PERFORM public.email_save_sender(ws_a, 'Mail A', 'hello@example.com', '<b>1 Main Street</b>, San Diego'); r := r || 'FAIL HTML address accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS HTML postal address refused'::text; END;
  j := public.email_save_sender(ws_a, 'Mail A Shop', 'Hello@Example.com', E'1 Main Street\nSan Diego, CA 92101', '#1D4ED8');
  r := r || (CASE WHEN j ->> 'business_name' = 'Mail A Shop' AND j ->> 'reply_to' = 'hello@example.com'
    AND j ->> 'brand_color' = '#1d4ed8' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' owner saves sender details');
  j := public.email_overview(ws_a);
  r := r || (CASE WHEN jsonb_array_length(j -> 'missing') = 0 AND (j -> 'contacts' ->> 'subscribed')::int = 5
    AND (j -> 'quota' ->> 'limit')::int = 4 AND (j ->> 'can_send')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' overview: ready, 5 subscribed, quota 4');
  EXECUTE 'RESET ROLE';

  -- c3 unsubscribed, c4 bounced, c5 complained: never selected.
  UPDATE public.email_contacts SET status = 'unsubscribed' WHERE id = c3;
  UPDATE public.email_contacts SET status = 'bounced' WHERE id = c4;
  UPDATE public.email_contacts SET status = 'complained' WHERE id = c5;

  PERFORM set_config('request.jwt.claims', claims_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.email_campaign_send(camp);
  r := r || (CASE WHEN (j ->> 'recipients')::int = 2 THEN 'PASS' ELSE 'FAIL ' || j::text END || ' send selects the 2 subscribed contacts only');
  BEGIN PERFORM public.email_campaign_save(ws_a, camp, content); r := r || 'FAIL edited a sending campaign'::text;
  EXCEPTION WHEN SQLSTATE 'PT409' THEN r := r || 'PASS a sending campaign cannot be edited'::text; END;
  BEGIN PERFORM public.email_campaign_send(camp); r := r || 'FAIL sent twice'::text;
  EXCEPTION WHEN SQLSTATE 'PT409' THEN r := r || 'PASS a campaign is sent once'::text; END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.email_campaign_recipients WHERE campaign_id = camp AND contact_id IN (c3, c4, c5);
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' unsubscribed, bounced and complained contacts not queued');

  -- c2 unsubscribes between the snapshot and the claim: skipped.
  UPDATE public.email_contacts SET status = 'unsubscribed' WHERE id = c2;
  PERFORM set_config('request.jwt.claims', claims_d, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.email_campaign_claim(camp);
  v_batch := (j ->> 'batch_no')::int;
  r := r || (CASE WHEN j ->> 'status' = 'batch' AND jsonb_array_length(j -> 'recipients') = 1
    AND j -> 'recipients' -> 0 ->> 'email' = 'ann.one@example.com' AND j -> 'recipients' -> 0 ->> 'token' = tok1
    AND j -> 'sender' ->> 'postal_address' IS NOT NULL
    THEN 'PASS' ELSE 'FAIL ' || left(j::text, 300) END || ' admin claims a batch: only still-subscribed contacts, with their token');
  rid := (j -> 'recipients' -> 0 ->> 'id')::bigint;
  j := public.email_campaign_claim(camp);
  r := r || (CASE WHEN j ->> 'status' = 'idle' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' a leased batch is not handed out twice');
  j := public.email_campaign_record(camp, v_batch, jsonb_build_object('outcome', 'sent',
    'messages', jsonb_build_array(jsonb_build_object('id', rid, 'message_id', 'msg-00000001'))));
  j := public.email_campaign_get(camp);
  r := r || (CASE WHEN j ->> 'status' = 'sent' AND (j -> 'stats' ->> 'sent')::int = 1 AND (j -> 'stats' ->> 'skipped')::int = 1
    THEN 'PASS' ELSE 'FAIL ' || j::text END || ' campaign sent: 1 sent, 1 skipped');
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN (SELECT status FROM public.email_campaign_recipients WHERE campaign_id = camp AND contact_id = c2) = 'skipped'
    THEN 'PASS' ELSE 'FAIL' END || ' contact unsubscribed after the snapshot is skipped');

  -- ---------- quota (4 per month: 2 queued so far) ----------
  PERFORM set_config('request.jwt.claims', claims_e, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  camp2 := (public.email_campaign_save(ws_a, NULL, content) ->> 'id')::uuid;
  j := public.email_campaign_test(camp2);
  r := r || (CASE WHEN j ->> 'to' = 'mail-e@example.invalid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' test goes to the caller only');
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN private.email_month_usage(org_a) = 2 AND private.org_usage(org_a, 'emails_month') = 2
    THEN 'PASS' ELSE 'FAIL ' || private.email_month_usage(org_a) END || ' usage counts sent + tests (2), skipped not counted');
  UPDATE public.email_contacts SET status = 'subscribed' WHERE id IN (c3, c4);  -- 3 subscribed now (c1, c3, c4)
  PERFORM set_config('request.jwt.claims', claims_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.email_campaign_send(camp2); r := r || 'FAIL quota exceeded'::text;
  EXCEPTION WHEN SQLSTATE 'PT402' THEN r := r || 'PASS plan quota enforced (2 used + 3 > 4)'::text; END;
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN NOT EXISTS (SELECT 1 FROM public.email_campaign_recipients WHERE campaign_id = camp2)
    AND (SELECT status FROM public.email_campaigns WHERE id = camp2) = 'draft' THEN 'PASS' ELSE 'FAIL' END || ' refused send queues nothing');
  UPDATE public.plans SET limits = '{"emails_month": 1000}' WHERE key = 'mail_test_plan';
  INSERT INTO private.email_site_state (website_id, daily_cap) VALUES (ws_a, 4);
  PERFORM set_config('request.jwt.claims', claims_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.email_campaign_send(camp2); r := r || 'FAIL daily cap exceeded'::text;
  EXCEPTION WHEN SQLSTATE 'PT429' THEN r := r || 'PASS per-site daily cap enforced'::text; END;
  EXECUTE 'RESET ROLE';
  UPDATE private.email_site_state SET daily_cap = 10000 WHERE website_id = ws_a;

  -- ---------- unsubscribe (anon) ----------
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.email_unsubscribe_info(tok1);
  r := r || (CASE WHEN j ->> 'status' = 'subscribed' AND j ->> 'email' = 'a***@e***.com' AND j ->> 'site_name' = 'Mail A Shop'
    THEN 'PASS' ELSE 'FAIL ' || j::text END || ' unsubscribe page: masked address and business name');
  j := public.email_unsubscribe('not-a-token');
  r := r || (CASE WHEN j ->> 'status' = 'invalid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' malformed token refused');
  j := public.email_unsubscribe(repeat('A', 43));
  r := r || (CASE WHEN j ->> 'status' = 'invalid' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' unknown token refused');
  j := public.email_unsubscribe(tok1, camp);
  r := r || (CASE WHEN j ->> 'status' = 'unsubscribed' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' one-click unsubscribe works');
  j := public.email_unsubscribe(tok1, camp);
  r := r || (CASE WHEN j ->> 'status' = 'already' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' the token works once (second use changes nothing)');
  BEGIN SELECT count(*) INTO n FROM public.email_contacts; r := r || 'FAIL anon reads contacts'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS anon cannot read contacts'::text; END;
  BEGIN PERFORM public.email_campaign_send(camp2); r := r || 'FAIL anon sent'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS anon cannot send'::text; END;
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN (SELECT status FROM public.email_contacts WHERE id = c1) = 'unsubscribed'
    AND (SELECT status FROM public.email_contacts WHERE id = c3) = 'subscribed'
    AND (SELECT status FROM public.email_contacts WHERE id = c4) = 'subscribed'
    AND (SELECT count(*) FROM public.email_contacts WHERE website_id = ws_b AND status = 'subscribed') = 1
    THEN 'PASS' ELSE 'FAIL' END || ' the token only reaches its own contact');
  r := r || (CASE WHEN (SELECT unsubscribed_at IS NOT NULL FROM public.email_campaign_recipients WHERE campaign_id = camp AND contact_id = c1)
    THEN 'PASS' ELSE 'FAIL' END || ' unsubscribe credited to the campaign');

  -- Signing up again: subscribed with a new token; the old link no longer resolves.
  INSERT INTO public.form_submissions (website_id, organization_id, form_type, ticket_code, email)
  VALUES (ws_a, org_a, 'newsletter', 'MT-0008', 'ann.one@example.com');
  r := r || (CASE WHEN (SELECT status = 'subscribed' AND token_version = 2 FROM public.email_contacts WHERE id = c1)
    AND (public.email_unsubscribe_info(tok1) ->> 'status') = 'invalid' THEN 'PASS' ELSE 'FAIL' END || ' re-subscribing replaces the token');
  INSERT INTO public.form_submissions (website_id, organization_id, form_type, ticket_code, email)
  VALUES (ws_a, org_a, 'newsletter', 'MT-0009', 'eve@example.com');
  r := r || (CASE WHEN (SELECT status FROM public.email_contacts WHERE id = c5) = 'complained'
    THEN 'PASS' ELSE 'FAIL' END || ' a complained address is not re-subscribed by a form');

  -- ---------- import ----------
  PERFORM set_config('request.jwt.claims', claims_d, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.email_contacts_import(ws_a, '[{"email": "new1@example.com"}]', false, 'Every contact agreed to receive e-mails.'); r := r || 'FAIL import without consent'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS import refused without the consent confirmation'::text; END;
  j := public.email_contacts_import(ws_a, '[{"email": "New1@example.com", "name": "New One"}, {"email": "new1@example.com"},
    {"email": "eve@example.com"}, {"email": "broken"}, {"email": "new2@example.com", "name": "<b>x</b>"}]'::jsonb, true,
    'Every contact agreed to receive e-mails from us.');
  r := r || (CASE WHEN (j ->> 'added')::int = 2 AND (j ->> 'existing')::int = 1 AND (j ->> 'invalid')::int = 1
    THEN 'PASS' ELSE 'FAIL ' || j::text END || ' import: 2 added, 1 existing, 1 invalid');
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN (SELECT status FROM public.email_contacts WHERE id = c5) = 'complained'
    AND (SELECT consent_confirmed AND imported_by = u_d FROM public.email_contact_imports WHERE id = (j ->> 'import_id')::uuid)
    AND (SELECT name IS NULL FROM public.email_contacts WHERE website_id = ws_a AND email = 'new2@example.com')
    THEN 'PASS' ELSE 'FAIL' END || ' import keeps existing statuses, records consent, drops HTML names');

  -- ---------- worker key, delivery events, auto-pause ----------
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM public.email_worker_due('lu_mail_' || repeat('0', 48)); r := r || 'FAIL unknown worker key accepted'::text;
  EXCEPTION WHEN SQLSTATE 'PT401' THEN r := r || 'PASS unknown worker key -> 401'::text; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', claims_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.admin_create_email_worker_key(); r := r || 'FAIL client created a worker key'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN r := r || 'PASS only staff create the worker key'::text; END;
  BEGIN PERFORM public.email_worker_claim('x', camp); r := r || 'FAIL signed-in user called the worker'::text;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS worker functions closed to signed-in users'::text; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', claims_s, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  wkey := public.admin_create_email_worker_key() ->> 'key';
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN wkey ~ '^lu_mail_[0-9a-f]{48}$' AND NOT EXISTS (SELECT 1 FROM private.email_worker_keys WHERE key_hash LIKE '%' || right(wkey, 16) || '%')
    THEN 'PASS' ELSE 'FAIL' END || ' worker key shown once, only its hash stored');

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.email_ingest_event(wkey, jsonb_build_object('id', 'evt-1', 'type', 'delivered', 'email_id', 'msg-00000001', 'created_at', now()));
  r := r || (CASE WHEN j ->> 'status' = 'applied' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' delivered event recorded');
  j := public.email_ingest_event(wkey, jsonb_build_object('id', 'evt-1', 'type', 'delivered', 'email_id', 'msg-00000001'));
  r := r || (CASE WHEN j ->> 'status' = 'duplicate' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' duplicate event ignored');
  j := public.email_ingest_event(wkey, jsonb_build_object('id', 'evt-2', 'type', 'delivered', 'email_id', 'not-ours-123'));
  r := r || (CASE WHEN j ->> 'status' = 'ignored' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' event for another e-mail ignored');
  j := public.email_ingest_event(wkey, jsonb_build_object('id', 'evt-3', 'type', 'bounced', 'email_id', 'msg-00000001', 'bounce_type', 'Permanent'));
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN (SELECT status FROM public.email_contacts WHERE id = c1) = 'bounced'
    AND (SELECT delivered_at IS NOT NULL AND bounced_at IS NOT NULL FROM public.email_campaign_recipients WHERE provider_message_id = 'msg-00000001')
    THEN 'PASS' ELSE 'FAIL' END || ' hard bounce marks the contact bounced');

  -- 120 e-mails sent in the last 30 days, then one complaint (0.8 %) pauses the site.
  INSERT INTO public.email_contacts (organization_id, website_id, email, source, consent_at, consent_source)
  SELECT org_a, ws_a, 'bulk' || g || '@example.com', 'import', now(), 'import:test' FROM generate_series(1, 120) g;
  INSERT INTO public.email_campaign_recipients (campaign_id, organization_id, website_id, contact_id, batch_no, status, sent_at, provider_message_id, created_at)
  SELECT camp, org_a, ws_a, c.id, 9, 'sent', now() - interval '1 day', 'bulk-msg-' || lpad(row_number() over ()::text, 6, '0'), now() - interval '40 days'
  FROM public.email_contacts c WHERE c.website_id = ws_a AND c.email LIKE 'bulk%';
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.email_ingest_event(wkey, jsonb_build_object('id', 'evt-4', 'type', 'complained', 'email_id', 'bulk-msg-000001'));
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN private.email_paused(ws_a) AND (SELECT status FROM public.email_contacts WHERE email = 'bulk1@example.com' AND website_id = ws_a) = 'complained'
    THEN 'PASS' ELSE 'FAIL' END || ' complaint rate over 0.3 % pauses sending');
  PERFORM set_config('request.jwt.claims', claims_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.email_campaign_send(camp2); r := r || 'FAIL sent while paused'::text;
  EXCEPTION WHEN SQLSTATE 'PT409' THEN r := r || 'PASS no sending while paused'::text; END;
  BEGIN PERFORM public.admin_email_resume_site(ws_a); r := r || 'FAIL client resumed'::text;
  EXCEPTION WHEN SQLSTATE 'PT403' THEN r := r || 'PASS only staff resume a paused site'::text; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', claims_s, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.admin_email_resume_site(ws_a);
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN NOT private.email_paused(ws_a) THEN 'PASS' ELSE 'FAIL' END || ' staff resume sending');

  -- ---------- scheduled campaign started by the worker ----------
  PERFORM set_config('request.jwt.claims', claims_a, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.email_campaign_schedule(camp2, now() + interval '1 minute'); r := r || 'FAIL schedule too soon accepted'::text;
  EXCEPTION WHEN SQLSTATE '22023' THEN r := r || 'PASS schedule needs at least 5 minutes'::text; END;
  j := public.email_campaign_schedule(camp2, now() + interval '1 hour');
  EXECUTE 'RESET ROLE';
  UPDATE public.email_campaigns SET scheduled_at = now() - interval '1 minute' WHERE id = camp2;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := public.email_worker_due(wkey);
  r := r || (CASE WHEN j @> to_jsonb(ARRAY[camp2::text]) THEN 'PASS' ELSE 'FAIL ' || j::text END || ' worker starts the due campaign');
  j := public.email_worker_claim(wkey, camp2);
  PERFORM public.email_worker_record(wkey, camp2, (j ->> 'batch_no')::int, '{"outcome": "retry", "error": "rate_limited"}');
  EXECUTE 'RESET ROLE';
  r := r || (CASE WHEN j ->> 'status' = 'batch' AND jsonb_array_length(j -> 'recipients') > 0 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(j -> 'recipients') x JOIN public.email_contacts c ON c.email = x ->> 'email' AND c.website_id = ws_a
      WHERE c.status <> 'subscribed')
    THEN 'PASS' ELSE 'FAIL ' || left(j::text, 200) END || ' worker batch holds subscribed contacts only');
  r := r || (CASE WHEN (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = camp2 AND status = 'queued') > 0
    THEN 'PASS' ELSE 'FAIL' END || ' retry puts the batch back in the queue');

  -- ---------- audit ----------
  SELECT count(*) INTO n FROM public.site_audit_log WHERE website_id = ws_a AND action IN
    ('email.sender_updated', 'email.campaign_created', 'email.campaign_started', 'email.test_sent',
     'email.contact_unsubscribed', 'email.contacts_imported', 'email.contact_bounced', 'email.sending_paused',
     'email.campaign_scheduled', 'email.campaign_finished');
  r := r || (CASE WHEN n >= 10 THEN 'PASS' ELSE 'FAIL ' || n END || ' mutations written to site_audit_log');
  r := r || (CASE WHEN EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'email.sending_resumed' AND target_id = ws_a)
    AND EXISTS (SELECT 1 FROM public.hq_audit_log WHERE action = 'email.worker_key_created')
    THEN 'PASS' ELSE 'FAIL' END || ' staff actions written to hq_audit_log');

  RAISE EXCEPTION E'EMAIL CAMPAIGNS TESTS (rolled back): % failed\n%',
    (SELECT count(*) FROM unnest(r) x WHERE x LIKE 'FAIL%'), array_to_string(r, E'\n');
END $$;
