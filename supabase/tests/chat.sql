-- Chat test suite: RLS isolation, RPC rules, validation, rate limits, column
-- encryption, visitor messages (contact form trigger + send_site_message).
--
-- Runs in one DO block and ALWAYS aborts at the end with RAISE EXCEPTION, so
-- nothing it creates is committed. The error message is the report and must
-- show "0 failed".

DO $test$
DECLARE
  u_a uuid := gen_random_uuid();   -- owner of org A
  u_e uuid := gen_random_uuid();   -- editor in org A
  u_v uuid := gen_random_uuid();   -- viewer in org A
  u_b uuid := gen_random_uuid();   -- owner of org B
  u_x uuid := gen_random_uuid();   -- signed in, no organization
  u_p uuid := gen_random_uuid();   -- LevelUp platform admin, not a member of A
  org_a uuid;
  org_b uuid;
  ws_a text;
  team_a uuid;
  team_b uuid;
  dm uuid;
  vis uuid;
  vis2 uuid;
  m1 uuid;
  m2 uuid;
  cid uuid := gen_random_uuid();
  j jsonb;
  n integer;
  t text;
  r text[] := '{}';
  failed integer;
BEGIN
  -- ---------- fixtures (as postgres) ----------
  INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data) VALUES
    (u_a, 'chat-a@test.local', 'authenticated', 'authenticated', '{"full_name":"Alice Owner"}'),
    (u_e, 'chat-e@test.local', 'authenticated', 'authenticated', '{"full_name":"Eve Editor"}'),
    (u_v, 'chat-v@test.local', 'authenticated', 'authenticated', '{"full_name":"Victor Viewer"}'),
    (u_b, 'chat-b@test.local', 'authenticated', 'authenticated', '{"full_name":"Bob Other"}'),
    (u_x, 'chat-x@test.local', 'authenticated', 'authenticated', '{}'),
    (u_p, 'chat-p@test.local', 'authenticated', 'authenticated', '{}');
  INSERT INTO public.platform_admins (user_id) VALUES (u_p);

  INSERT INTO public.organizations (name, slug, status, created_by)
  VALUES ('Chat Org A', 'chat-org-a-' || substr(md5(u_a::text), 1, 6), 'active', u_a) RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug, status, created_by)
  VALUES ('Chat Org B', 'chat-org-b-' || substr(md5(u_b::text), 1, 6), 'active', u_b) RETURNING id INTO org_b;
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (org_a, u_a, 'owner'), (org_b, u_b, 'owner');
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (org_a, u_e, 'editor'), (org_a, u_v, 'viewer');
  -- joined yesterday (team unread counts from the join date)
  UPDATE public.organization_members SET created_at = now() - interval '1 day' WHERE organization_id IN (org_a, org_b);
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'Chat Site A', 'active') RETURNING id INTO ws_a;
  INSERT INTO public.website_features (website_id, organization_id, feature_key) VALUES (ws_a, org_a, 'contact_form');

  -- ---------- team channel ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.chat_list_conversations(org_a);
  team_a := (j -> 0 ->> 'id')::uuid;
  r := r || (CASE WHEN jsonb_array_length(j) = 1 AND j -> 0 ->> 'kind' = 'team' THEN 'PASS' ELSE 'FAIL ' || j::text END || ' team channel created on first read');
  j := public.chat_list_conversations(org_a);
  r := r || (CASE WHEN jsonb_array_length(j) = 1 AND (j -> 0 ->> 'id')::uuid = team_a THEN 'PASS' ELSE 'FAIL' END || ' one team channel per organization');

  j := public.chat_send_message(team_a, E'Hello team\x07 https://example.com', null, cid);
  m1 := (j ->> 'id')::uuid;
  r := r || (CASE WHEN j ->> 'body' = 'Hello team https://example.com' AND (j ->> 'mine')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' send: control characters stripped');
  j := public.chat_send_message(team_a, 'Hello team (retry)', null, cid);
  r := r || (CASE WHEN (j ->> 'id')::uuid = m1 THEN 'PASS' ELSE 'FAIL' END || ' send retry with the same client id is idempotent');
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO n FROM public.chat_messages WHERE id = m1
    AND position(convert_to('Hello team', 'UTF8') IN body_ciphertext) = 0
    AND body_ciphertext IS NOT NULL;
  r := r || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' body stored encrypted (no plaintext in the column)');

  -- editor A reads the team channel, sees 1 unread
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.chat_messages WHERE conversation_id = team_a;
  r := r || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' member SELECT (Realtime RLS) sees team messages');
  n := public.chat_unread_total(org_a);
  r := r || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL ' || n END || ' unread total for the editor');
  j := public.chat_list_messages(team_a);
  r := r || (CASE WHEN jsonb_array_length(j) = 1 AND j -> 0 ->> 'sender_name' = 'Alice Owner' AND NOT (j -> 0 ->> 'mine')::boolean THEN 'PASS' ELSE 'FAIL ' || j::text END || ' editor lists team messages');
  PERFORM public.chat_mark_read(team_a);
  n := public.chat_unread_total(org_a);
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' mark read clears unread');
  BEGIN
    PERFORM public.chat_edit_message(m1, 'not mine');
    r := r || 'FAIL editor edited a message of someone else'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT403' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' cannot edit another member message');
  END;
  BEGIN
    PERFORM public.chat_delete_message(m1);
    r := r || 'FAIL editor deleted a message of someone else'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT403' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' cannot delete another member message');
  END;
  j := public.chat_send_message(team_a, 'Reply', m1);
  r := r || (CASE WHEN j -> 'reply_to' ->> 'id' = m1::text THEN 'PASS' ELSE 'FAIL ' || j::text END || ' reply-to quote');
  EXECUTE 'RESET ROLE';

  -- ---------- cross-organization isolation ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.chat_messages;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END || ' other org SELECT sees no message');
  SELECT count(*) INTO n FROM public.chat_conversations WHERE organization_id = org_a;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' other org SELECT sees no conversation');
  BEGIN
    PERFORM public.chat_list_messages(team_a);
    r := r || 'FAIL other org listed team A messages'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT404' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' other org cannot list team A messages');
  END;
  BEGIN
    PERFORM public.chat_send_message(team_a, 'intrusion');
    r := r || 'FAIL other org posted in team A'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT404' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' other org cannot post in team A');
  END;
  BEGIN
    PERFORM public.chat_list_conversations(org_a);
    r := r || 'FAIL other org listed org A conversations'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT403' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' other org cannot list org A conversations');
  END;
  BEGIN
    PERFORM public.chat_get_message(m1);
    r := r || 'FAIL other org read a message by id'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT404' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' other org cannot read a message by id');
  END;
  j := public.chat_list_conversations(org_b);
  team_b := (j -> 0 ->> 'id')::uuid;
  r := r || (CASE WHEN team_b IS NOT NULL AND team_b <> team_a THEN 'PASS' ELSE 'FAIL' END || ' org B has its own team channel');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.chat_list_conversations(org_a);
    r := r || 'FAIL non member listed conversations'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT403' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' non member refused');
  END;
  n := public.chat_unread_total(org_a);
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' non member unread total is 0');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.chat_messages WHERE conversation_id = team_a;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' platform admin (not a member) cannot read client chat');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.chat_list_messages(team_a);
    r := r || 'FAIL anon listed messages'::text;
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'PASS anon cannot call chat RPCs'::text;
  END;
  BEGIN
    SELECT count(*) INTO n FROM public.chat_messages;
    r := r || 'FAIL anon read chat_messages'::text;
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'PASS anon cannot read chat tables'::text;
  END;
  EXECUTE 'RESET ROLE';

  -- ---------- direct conversations ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  dm := public.chat_open_direct(org_a, u_e);
  r := r || (CASE WHEN public.chat_open_direct(org_a, u_e) = dm THEN 'PASS' ELSE 'FAIL' END || ' direct conversation reused');
  BEGIN
    PERFORM public.chat_open_direct(org_a, u_b);
    r := r || 'FAIL direct conversation with another org member'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = '22023' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' direct only between members of the same org');
  END;
  BEGIN
    PERFORM public.chat_open_direct(org_a, u_a);
    r := r || 'FAIL direct conversation with self'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = '22023' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' no direct conversation with yourself');
  END;
  j := public.chat_send_message(dm, 'Private hello');
  m2 := (j ->> 'id')::uuid;

  -- validation
  BEGIN
    PERFORM public.chat_send_message(dm, '<script>alert(1)</script>');
    r := r || 'FAIL HTML accepted'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = '22023' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' HTML refused');
  END;
  BEGIN
    PERFORM public.chat_send_message(dm, E' \n​ ');
    r := r || 'FAIL empty message accepted'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = '22023' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' empty message refused');
  END;
  BEGIN
    PERFORM public.chat_send_message(dm, repeat('a', 4001));
    r := r || 'FAIL 4001 characters accepted'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = '22023' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' over 4000 characters refused');
  END;
  j := public.chat_send_message(dm, repeat('a', 4000));
  r := r || (CASE WHEN char_length(j ->> 'body') = 4000 THEN 'PASS' ELSE 'FAIL' END || ' 4000 characters accepted');
  BEGIN
    PERFORM public.chat_send_message(dm, 'cross reply', team_b);
    r := r || 'FAIL reply to a message of another conversation'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = '22023' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' reply must be in the same conversation');
  END;

  -- edit / delete own
  j := public.chat_edit_message(m2, 'Private hello (edited)');
  r := r || (CASE WHEN j ->> 'body' = 'Private hello (edited)' AND j ->> 'edited_at' IS NOT NULL THEN 'PASS' ELSE 'FAIL' END || ' edit own message');
  j := public.chat_delete_message(m2);
  r := r || (CASE WHEN j ->> 'body' IS NULL AND j ->> 'deleted_at' IS NOT NULL THEN 'PASS' ELSE 'FAIL' END || ' soft delete own message');
  BEGIN
    PERFORM public.chat_edit_message(m2, 'back');
    r := r || 'FAIL edited a deleted message'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT403' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' deleted message cannot be edited');
  END;

  -- tables are read-only for clients
  BEGIN
    INSERT INTO public.chat_messages (conversation_id, organization_id, sender_user_id, body_ciphertext)
    VALUES (dm, org_a, u_a, '\x00');
    r := r || 'FAIL direct insert into chat_messages'::text;
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'PASS no direct insert into chat_messages'::text;
  END;
  BEGIN
    UPDATE public.chat_messages SET deleted_at = now() WHERE id = m1;
    r := r || 'FAIL direct update of chat_messages'::text;
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'PASS no direct update of chat_messages'::text;
  END;
  BEGIN
    INSERT INTO public.chat_participants (conversation_id, user_id) VALUES (team_b, u_a);
    r := r || 'FAIL joined a conversation by insert'::text;
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'PASS cannot join a conversation by insert'::text;
  END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.chat_messages WHERE conversation_id = dm;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' third member cannot read a direct conversation');
  BEGIN
    PERFORM public.chat_send_message(dm, 'hi');
    r := r || 'FAIL third member posted in a direct conversation'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT404' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' third member cannot post in a direct conversation');
  END;
  EXECUTE 'RESET ROLE';

  -- ---------- rate limit: 30 messages per minute per account ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  -- each call in its own block: a refusal only undoes that call
  FOR i IN 1..40 LOOP
    BEGIN
      PERFORM public.chat_send_message(dm, 'flood ' || i);
    EXCEPTION WHEN others THEN
      t := coalesce(t, SQLSTATE);
    END;
  END LOOP;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.chat_messages WHERE sender_user_id = u_a AND created_at > now() - interval '1 minute';
  r := r || (CASE WHEN t = 'PT429' AND n = 30 THEN 'PASS' ELSE 'FAIL ' || coalesce(t, '-') || ' ' || n END || ' rate limit 30 per minute (PT429)');

  -- ---------- second factor (aal2) ----------
  INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  VALUES (gen_random_uuid(), u_v, 'test', 'totp', 'verified', now(), now());
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.chat_list_messages(team_a);
    r := r || 'FAIL aal1 session with a verified factor read messages'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLERRM LIKE '%aal2%' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' aal1 refused when the user has a second factor');
  END;
  SELECT count(*) INTO n FROM public.chat_messages WHERE conversation_id = team_a;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' aal1 SELECT (Realtime) sees nothing');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := public.chat_list_messages(team_a);
  r := r || (CASE WHEN jsonb_array_length(j) = 2 THEN 'PASS' ELSE 'FAIL' END || ' aal2 session reads');
  EXECUTE 'RESET ROLE';

  -- ---------- visitor messages: contact form ----------
  INSERT INTO public.form_submissions (website_id, organization_id, form_type, ticket_code, name, email, message)
  VALUES (ws_a, org_a, 'contact', 'TST-CHAT-1', 'Jane Visitor', 'jane@example.com', 'Do you open on Sundays?');
  SELECT c.id INTO vis FROM public.chat_conversations c WHERE c.website_id = ws_a AND c.kind = 'visitor';
  r := r || (CASE WHEN vis IS NOT NULL THEN 'PASS' ELSE 'FAIL' END || ' contact form message becomes a visitor conversation');
  INSERT INTO public.form_submissions (website_id, organization_id, form_type, ticket_code, name, email, message)
  VALUES (ws_a, org_a, 'contact', 'TST-CHAT-2', 'Jane Visitor', 'JANE@example.com', 'And on holidays?');
  SELECT count(*) INTO n FROM public.chat_messages WHERE conversation_id = vis AND kind = 'visitor';
  r := r || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL ' || n END || ' same e-mail joins the open conversation');
  INSERT INTO public.form_submissions (website_id, organization_id, form_type, ticket_code, name, email)
  VALUES (ws_a, org_a, 'newsletter', 'TST-CHAT-3', 'News', 'news@example.com');
  SELECT count(*) INTO n FROM public.chat_conversations WHERE website_id = ws_a;
  r := r || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' other form types stay out of the chat');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := (SELECT e FROM jsonb_array_elements(public.chat_list_conversations(org_a)) e WHERE e ->> 'kind' = 'visitor');
  r := r || (CASE WHEN j -> 'visitor' ->> 'email' = 'j***@e***.com' THEN 'PASS' ELSE 'FAIL ' || coalesce(j::text, 'null') END || ' viewer sees a masked visitor e-mail');
  BEGIN
    PERFORM public.chat_visitor_contact(vis);
    r := r || 'FAIL viewer read visitor contact'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT403' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' viewer cannot read visitor contact');
  END;
  BEGIN
    PERFORM public.chat_send_message(vis, 'note by viewer');
    r := r || 'FAIL viewer wrote a note'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT403' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' viewer cannot write notes');
  END;
  BEGIN
    PERFORM public.chat_set_visitor_status(vis, 'resolved');
    r := r || 'FAIL viewer resolved a conversation'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT403' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' viewer cannot resolve');
  END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := (SELECT e FROM jsonb_array_elements(public.chat_list_conversations(org_a)) e WHERE e ->> 'kind' = 'visitor');
  r := r || (CASE WHEN j -> 'visitor' ->> 'email' = 'jane@example.com' AND (j ->> 'unread')::int = 2 THEN 'PASS' ELSE 'FAIL ' || coalesce(j::text, 'null') END || ' editor sees the visitor e-mail and 2 unread');
  j := public.chat_visitor_contact(vis);
  r := r || (CASE WHEN j ->> 'email' = 'jane@example.com' THEN 'PASS' ELSE 'FAIL' END || ' editor reads visitor contact');
  j := public.chat_send_message(vis, 'Called her back.');
  r := r || (CASE WHEN j ->> 'kind' = 'note' THEN 'PASS' ELSE 'FAIL' END || ' staff reply in a visitor conversation is an internal note');
  PERFORM public.chat_set_visitor_status(vis, 'resolved');
  BEGIN
    PERFORM public.chat_set_visitor_status(vis, 'deleted');
    r := r || 'FAIL unknown status accepted'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = '22023' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' unknown status refused');
  END;
  EXECUTE 'RESET ROLE';

  INSERT INTO public.form_submissions (website_id, organization_id, form_type, ticket_code, name, email, message)
  VALUES (ws_a, org_a, 'contact', 'TST-CHAT-4', 'Jane Visitor', 'jane@example.com', 'One more question');
  SELECT count(*) INTO n FROM public.chat_conversations WHERE website_id = ws_a AND kind = 'visitor';
  r := r || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL ' || n END || ' a resolved conversation is not reopened: new one');

  -- ---------- visitor messages: send_site_message ----------
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.send_site_message(ws_a, 'Sam', 'sam@example.com', 'Hi');
    r := r || 'FAIL send_site_message without the site_chat feature'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT403' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' send_site_message needs the site_chat feature');
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO public.website_features (website_id, organization_id, feature_key) VALUES (ws_a, org_a, 'site_chat');

  EXECUTE 'SET LOCAL ROLE anon';
  j := public.send_site_message(ws_a, 'Bot', 'bot@example.com', 'spam', 'filled');
  r := r || (CASE WHEN (j ->> 'ok')::boolean THEN 'PASS' ELSE 'FAIL' END || ' honeypot answers ok');
  j := public.send_site_message(ws_a, 'Sam', 'sam@example.com', 'Hi, is the shop open?');
  BEGIN
    PERFORM public.send_site_message(ws_a, 'Sam', 'sam@example.com', '<b>bold</b>');
    r := r || 'FAIL HTML accepted from a visitor'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = '22023' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' HTML refused from a visitor');
  END;
  BEGIN
    PERFORM public.send_site_message(ws_a, 'Sam', 'not-an-email', 'Hello');
    r := r || 'FAIL invalid e-mail accepted'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = '22023' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' invalid visitor e-mail refused');
  END;
  BEGIN
    PERFORM public.send_site_message('ws_doesnotexist00', 'Sam', 'sam@example.com', 'Hello');
    r := r || 'FAIL unknown website accepted'::text;
  EXCEPTION WHEN others THEN
    r := r || (CASE WHEN SQLSTATE = 'PT404' THEN 'PASS' ELSE 'FAIL ' || SQLSTATE END || ' unknown website refused');
  END;
  t := null;
  FOR i IN 1..25 LOOP
    BEGIN
      PERFORM public.send_site_message(ws_a, 'Sam', 'sam@example.com', 'again ' || i);
    EXCEPTION WHEN others THEN
      t := coalesce(t, SQLSTATE);
    END;
  END LOOP;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.chat_messages m JOIN public.chat_visitors v ON v.conversation_id = m.conversation_id
  WHERE v.email = 'sam@example.com' AND m.kind = 'visitor';
  r := r || (CASE WHEN t = 'PT429' AND n = 20 THEN 'PASS' ELSE 'FAIL ' || coalesce(t, '-') || ' ' || n END || ' visitor rate limit 20 per hour per e-mail');
  SELECT count(*) INTO n FROM public.chat_visitors WHERE email = 'bot@example.com';
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' honeypot stores nothing');

  -- ---------- archived organization ----------
  UPDATE public.organizations SET status = 'archived' WHERE id = org_a;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.chat_messages WHERE conversation_id = team_a;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' archived organization: chat closed');
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO failed FROM unnest(r) x WHERE x LIKE 'FAIL%';
  RAISE EXCEPTION E'CHAT TESTS (rolled back): % failed\n%', failed, array_to_string(r, E'\n');
END;
$test$;
