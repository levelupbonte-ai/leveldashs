-- Cross-tenant isolation suite: one organization / user must never read or
-- change another one's data.
--
-- Fixtures: organizations A and B (owner + viewer in A, owner + editor in B),
-- one live website each, one row in every tenant table (customer PII carries
-- the markers "zza" / "zzb" and the numbers 1111 / 4242), two LevelStudio users,
-- two platform admins (one with a verified authenticator app).
--
-- Checks:
--   * catalog: RLS on every public table, no anon write grant, anon EXECUTE
--     allow-list, search_path on every SECURITY DEFINER function, views are
--     security_invoker, realtime tables have RLS, private buckets;
--   * every table with organization_id: as A's owner, B's editor and anon,
--     SELECT / UPDATE / DELETE the other tenant's rows (public-by-design rows
--     excluded by evaluating the public policies), and no row of any other
--     real tenant is visible;
--   * direct INSERTs into the other tenant, Storage objects;
--   * every member-facing RPC called with the other tenant's ids (+ positive
--     controls so a broken call never passes silently);
--   * anon on member RPCs and public RPCs with cross-site ids;
--   * viewer masking of customer e-mails (payments, chat visitors);
--   * LevelStudio per-user isolation; platform admin powers need aal2.
--
-- Runs inside one DO block and ALWAYS ends with RAISE EXCEPTION, so nothing is
-- ever committed. The exception message is the report: it must show 0 failed.
-- Usage: paste into the Supabase SQL editor (or execute_sql) and read the error.

DO $$
DECLARE
  owners uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  members uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid();   -- platform admin with a verified TOTP factor
  p2 uuid := gen_random_uuid();   -- platform admin without MFA
  mk text[] := array['zza', 'zzb'];
  num int[] := array[1111, 4242];
  orgs uuid[] := '{}';
  sites text[] := '{}';
  pays uuid[] := '{}';
  keys uuid[] := '{}';
  convs uuid[] := '{}';
  vconvs uuid[] := '{}';
  msgs uuid[] := '{}';
  invs uuid[] := '{}';
  contracts uuid[] := array[null::uuid, null::uuid];
  tickets text[] := '{}';
  o uuid; w text; u uuid; m text; k int;
  v_id uuid; v_text text; v_plan text; n bigint;
  pub jsonb;
  results text[] := '{}';
  notes text[] := '{}';
  failed int;
BEGIN
  -- ================================================================ helpers
  EXECUTE $f$
    CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $b$
    DECLARE r text;
    BEGIN
      EXECUTE q INTO r;
      RETURN coalesce(r, '<null>');
    EXCEPTION WHEN OTHERS THEN
      RETURN 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 100);
    END $b$ $f$;

  -- must_refuse: any success is a FAIL. Otherwise a success passes when it
  -- contains none of the markers (and matches ok_regex when given).
  EXECUTE $f$
    CREATE FUNCTION pg_temp.judge(label text, r text, must_refuse boolean, markers text[], ok_regex text DEFAULT NULL)
    RETURNS text LANGUAGE plpgsql AS $b$
    DECLARE x text;
    BEGIN
      IF r ~ '^ERR:(42883|42P01|42703|42601|42804|42725|42P18|42702)' THEN
        RETURN 'FAIL ' || label || ' (test error: ' || r || ')';
      ELSIF r LIKE 'ERR:%' THEN
        RETURN 'PASS ' || label || ' refused ' || substr(r, 5, 5);
      ELSIF must_refuse THEN
        RETURN 'FAIL ' || label || ' accepted: ' || left(r, 160);
      END IF;
      FOREACH x IN ARRAY coalesce(markers, '{}') LOOP
        IF position(lower(x) IN lower(r)) > 0 THEN
          RETURN 'FAIL ' || label || ' leaked "' || x || '": ' || left(r, 160);
        END IF;
      END LOOP;
      IF ok_regex IS NOT NULL AND r !~ ok_regex THEN
        RETURN 'FAIL ' || label || ' unexpected: ' || left(r, 160);
      END IF;
      RETURN 'PASS ' || label;
    END $b$ $f$;

  -- Tables carrying organization_id.
  EXECUTE $f$
    CREATE FUNCTION pg_temp.tenant_tables() RETURNS SETOF text LANGUAGE sql AS $b$
      SELECT c.relname::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY 1 $b$ $f$;

  -- As postgres: per table, how many rows (of p_org, or outside p_org when
  -- p_outside) a role may see BY DESIGN through its public SELECT policies.
  EXECUTE $f$
    CREATE FUNCTION pg_temp.public_counts(p_org uuid, p_outside boolean, p_role text) RETURNS jsonb LANGUAGE plpgsql AS $b$
    DECLARE t text; q text; r jsonb := '{}'; n bigint;
    BEGIN
      FOR t IN SELECT * FROM pg_temp.tenant_tables() LOOP
        SELECT string_agg('(' || pg_get_expr(p.polqual, p.polrelid) || ')', ' OR ') INTO q
        FROM pg_policy p
        WHERE p.polrelid = ('public.' || quote_ident(t))::regclass
          AND p.polcmd IN ('r', '*') AND p.polpermissive AND p.polqual IS NOT NULL
          AND (p.polroles = '{0}' OR (SELECT oid FROM pg_roles WHERE rolname = p_role) = ANY (p.polroles))
          -- member policies are not "public": they depend on the caller
          AND pg_get_expr(p.polqual, p.polrelid) !~ '(has_org_role|auth\.uid|is_platform_admin|chat_can_read|hq_)';
        IF q IS NULL THEN
          n := 0;
        ELSE
          EXECUTE format('SELECT count(*) FROM public.%I WHERE (organization_id %s $1) AND (%s)', t,
            CASE WHEN p_outside THEN 'IS DISTINCT FROM' ELSE '=' END, q) INTO n USING p_org;
        END IF;
        r := r || jsonb_build_object(t, n);
      END LOOP;
      RETURN r;
    END $b$ $f$;

  -- As the attacker: SELECT / UPDATE / DELETE the victim's rows in every
  -- tenant table. p_pub = public_counts(victim, false). With p_own and
  -- p_outside_pub, also checks nothing outside the attacker's org is visible.
  EXECUTE $f$
    CREATE FUNCTION pg_temp.probe(label text, p_victim uuid, p_pub jsonb, p_own uuid, p_outside_pub jsonb)
    RETURNS text[] LANGUAGE plpgsql AS $b$
    DECLARE t text; col text; n bigint; lim bigint; out text[] := '{}';
    BEGIN
      FOR t IN SELECT * FROM pg_temp.tenant_tables() LOOP
        lim := coalesce((p_pub ->> t)::bigint, 0);
        BEGIN
          EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id = $1', t) INTO n USING p_victim;
          out := out || (CASE WHEN n <= lim THEN 'PASS ' ELSE 'FAIL ' END || label || ' select ' || t || ' (' || n || ' seen, ' || lim || ' public)');
        EXCEPTION WHEN insufficient_privilege THEN
          out := out || ('PASS ' || label || ' select ' || t || ' (no grant)');
        WHEN OTHERS THEN
          out := out || ('FAIL ' || label || ' select ' || t || ' error ' || SQLSTATE || ' ' || left(SQLERRM, 80));
        END;

        IF p_outside_pub IS NOT NULL THEN
          lim := coalesce((p_outside_pub ->> t)::bigint, 0);
          BEGIN
            EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id IS DISTINCT FROM $1', t) INTO n USING p_own;
            out := out || (CASE WHEN n <= lim THEN 'PASS ' ELSE 'FAIL ' END || label || ' no other tenant in ' || t || ' (' || n || ' seen, ' || lim || ' public)');
          EXCEPTION WHEN insufficient_privilege THEN
            NULL;
          END;
        END IF;

        SELECT a.attname INTO col FROM pg_attribute a
        WHERE a.attrelid = ('public.' || quote_ident(t))::regclass AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege(current_user, a.attrelid, a.attnum, 'UPDATE')
        ORDER BY a.attnum LIMIT 1;
        IF col IS NULL THEN
          out := out || ('PASS ' || label || ' update ' || t || ' (no grant)');
        ELSE
          BEGIN
            EXECUTE format('UPDATE public.%I SET %I = %I WHERE organization_id = $1', t, col, col) USING p_victim;
            GET DIAGNOSTICS n = ROW_COUNT;
            out := out || (CASE WHEN n = 0 THEN 'PASS ' ELSE 'FAIL ' END || label || ' update ' || t || ' (' || n || ' rows)');
          EXCEPTION WHEN insufficient_privilege THEN
            out := out || ('PASS ' || label || ' update ' || t || ' (no grant)');
          WHEN OTHERS THEN
            out := out || ('FAIL ' || label || ' update ' || t || ' error ' || SQLSTATE || ' ' || left(SQLERRM, 80));
          END;
        END IF;

        IF NOT has_table_privilege(current_user, ('public.' || quote_ident(t))::regclass, 'DELETE') THEN
          out := out || ('PASS ' || label || ' delete ' || t || ' (no grant)');
        ELSE
          BEGIN
            EXECUTE format('DELETE FROM public.%I WHERE organization_id = $1', t) USING p_victim;
            GET DIAGNOSTICS n = ROW_COUNT;
            out := out || (CASE WHEN n = 0 THEN 'PASS ' ELSE 'FAIL ' END || label || ' delete ' || t || ' (' || n || ' rows)');
          EXCEPTION WHEN insufficient_privilege THEN
            out := out || ('PASS ' || label || ' delete ' || t || ' (no grant)');
          WHEN OTHERS THEN
            out := out || ('FAIL ' || label || ' delete ' || t || ' error ' || SQLSTATE || ' ' || left(SQLERRM, 80));
          END;
        END IF;
      END LOOP;
      RETURN out;
    END $b$ $f$;

  -- Rows of a user-keyed table that do not belong to p_user.
  EXECUTE $f$
    CREATE FUNCTION pg_temp.foreign_rows(t text, col text, p_user uuid) RETURNS text LANGUAGE plpgsql AS $b$
    DECLARE n bigint;
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS DISTINCT FROM $1', t, col) INTO n USING p_user;
      RETURN n::text;
    EXCEPTION WHEN insufficient_privilege THEN
      RETURN 'ERR:42501 no grant';
    END $b$ $f$;

  -- =============================================================== catalog
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE s.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' catalog: RLS on every public table (' || n || ' without)');

  SELECT string_agg(c.relname, ',') INTO v_text FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE s.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
    AND (has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE')
      OR has_table_privilege('anon', c.oid, 'DELETE') OR has_table_privilege('anon', c.oid, 'TRUNCATE'));
  results := results || (CASE WHEN v_text IS NULL THEN 'PASS' ELSE 'FAIL' END || ' catalog: no anon write grant ' || coalesce(v_text, ''));

  SELECT string_agg(p.proname, ',') INTO v_text FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
  WHERE s.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.proname NOT IN ('book_appointment', 'create_project_handoff', 'get_organization_invitation',
      'get_public_waitlist', 'get_public_website', 'get_site_bundle', 'get_ticket_status', 'hq_sign_in_attempt',
      'join_waitlist', 'record_project_qualification', 'send_site_message', 'site_ingest_payment', 'submit_form',
      'submit_project_request', 'tag_ping', 'track_pageview');
  results := results || (CASE WHEN v_text IS NULL THEN 'PASS' ELSE 'FAIL' END || ' catalog: anon EXECUTE only on the public RPC allow-list ' || coalesce(v_text, ''));

  SELECT string_agg(p.proname, ',') INTO v_text FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
  WHERE s.nspname = 'public' AND p.proname IN ('studio_consume_usage', 'studio_consume_credits', 'studio_rate_hit',
      'studio_project_allowance', 'ai_key_report')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  results := results || (CASE WHEN v_text IS NULL THEN 'PASS' ELSE 'FAIL' END || ' catalog: server-only functions closed to API roles ' || coalesce(v_text, ''));

  SELECT string_agg(s.nspname || '.' || p.proname, ',') INTO v_text FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
  WHERE s.nspname IN ('public', 'private') AND p.prosecdef
    AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg WHERE cfg LIKE 'search_path=%');
  results := results || (CASE WHEN v_text IS NULL THEN 'PASS' ELSE 'FAIL' END || ' catalog: search_path on every SECURITY DEFINER function ' || coalesce(v_text, ''));

  SELECT string_agg(c.relname, ',') INTO v_text FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE s.nspname = 'public' AND c.relkind = 'v'
    AND NOT coalesce('security_invoker=true' = ANY (c.reloptions) OR 'security_invoker=on' = ANY (c.reloptions), false);
  results := results || (CASE WHEN v_text IS NULL THEN 'PASS' ELSE 'FAIL' END || ' catalog: views are security_invoker ' || coalesce(v_text, ''));

  SELECT string_agg(pt.tablename, ',') INTO v_text FROM pg_publication_tables pt
  JOIN pg_class c ON c.relname = pt.tablename JOIN pg_namespace s ON s.oid = c.relnamespace AND s.nspname = pt.schemaname
  WHERE pt.pubname = 'supabase_realtime' AND NOT c.relrowsecurity;
  results := results || (CASE WHEN v_text IS NULL THEN 'PASS' ELSE 'FAIL' END || ' catalog: realtime tables have RLS ' || coalesce(v_text, ''));

  SELECT count(*) INTO n FROM storage.buckets WHERE id = 'contracts' AND NOT public;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' catalog: contracts bucket is private');

  -- ============================================================== fixtures
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  SELECT x.id, x.email, 'authenticated', 'authenticated', now(), '{}'::jsonb
  FROM (VALUES (owners[1], 'iso-owner-a@test.local'), (members[1], 'iso-viewer-a@test.local'),
               (owners[2], 'iso-owner-b@test.local'), (members[2], 'iso-editor-b@test.local'),
               (s1, 'iso-studio-1@test.local'), (s2, 'iso-studio-2@test.local'),
               (p1, 'iso-staff-1@test.local'), (p2, 'iso-staff-2@test.local')) AS x(id, email);

  SELECT key INTO v_plan FROM public.plans ORDER BY is_default DESC, sort_order LIMIT 1;

  FOR k IN 1..2 LOOP
    m := mk[k];
    INSERT INTO public.organizations (name, slug, status)
    VALUES ('Iso Org ' || k, 'iso-org-' || k || '-' || substr(md5(random()::text), 1, 8), 'active')
    RETURNING id INTO o;
    orgs := orgs || o;
    u := owners[k];
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (o, u, 'owner'), (o, members[k], CASE WHEN k = 1 THEN 'viewer' ELSE 'editor' END);
    INSERT INTO public.websites (organization_id, name, status, allowed_origins)
    VALUES (o, 'Iso Site ' || k, 'active', ARRAY['https://iso-' || k || '.test'])
    RETURNING id INTO w;
    sites := sites || w;
    INSERT INTO public.website_features (website_id, organization_id, feature_key)
    SELECT w, o, f FROM unnest(ARRAY['contact_form', 'bookings', 'waitlist', 'payments', 'site_chat', 'services', 'team']) f
    WHERE EXISTS (SELECT 1 FROM public.features WHERE key = f);

    tickets := tickets || ('T' || k || '-' || upper(substr(md5(random()::text), 1, 8)));
    INSERT INTO public.form_submissions (website_id, organization_id, form_type, ticket_code, name, email, phone, message)
    VALUES (w, o, 'contact', tickets[k], 'Sam ' || m, m || '-lead@test.local', '+1555000000' || k, m || ' private message');
    INSERT INTO public.appointments (website_id, organization_id, ticket_code, customer_name, customer_email, customer_phone, appointment_date, appointment_time)
    VALUES (w, o, 'A' || k || '-' || upper(substr(md5(random()::text), 1, 8)), 'Ann ' || m, m || '-appt@test.local', '+1555000100' || k, current_date + 1, '10:00');
    INSERT INTO public.waitlist_entries (website_id, organization_id, ticket_code, customer_name, customer_email, position)
    VALUES (w, o, 'W' || k || '-' || upper(substr(md5(random()::text), 1, 8)), 'Walter Q', m || '-wait@test.local', 1);

    INSERT INTO public.site_payments (website_id, organization_id, provider_event_id, provider_session_id, status, amount, currency,
      occurred_at, paid_at, customer_email, customer_name, livemode)
    VALUES (w, o, 'evt_iso_' || m, 'cs_iso_' || m, 'paid', num[k], 'usd', now(), now(), m || '-cust@test.local', 'Cust ' || m, true)
    RETURNING id INTO v_id;
    pays := pays || v_id;
    INSERT INTO public.site_payment_events (payment_id, website_id, organization_id, provider_event_id, status, amount, applied)
    VALUES (v_id, w, o, 'evt_iso_' || m, 'paid', num[k], true);
    INSERT INTO public.site_api_keys (website_id, organization_id, name, prefix, key_hint, key_hash, scopes)
    VALUES (w, o, m || ' key', 'lu_test_', 'abcd', encode(extensions.digest(random()::text, 'sha256'), 'hex'), '{payments:write}')
    RETURNING id INTO v_id;
    keys := keys || v_id;

    INSERT INTO public.chat_conversations (organization_id, kind, created_by)
    VALUES (o, 'team', u)
    ON CONFLICT (organization_id) WHERE kind = 'team' DO NOTHING;
    SELECT id INTO v_id FROM public.chat_conversations WHERE organization_id = o AND kind = 'team';
    convs := convs || v_id;
    INSERT INTO public.chat_participants (conversation_id, user_id, role) VALUES (v_id, u, 'member')
    ON CONFLICT DO NOTHING;
    INSERT INTO public.chat_messages (conversation_id, organization_id, kind, sender_user_id, body_ciphertext)
    VALUES (v_id, o, 'message', u, private.chat_encrypt(m || ' team secret', private.chat_key(1)))
    RETURNING id INTO v_id;
    msgs := msgs || v_id;
    INSERT INTO public.chat_conversations (organization_id, kind, website_id, title)
    VALUES (o, 'visitor', w, 'Visitor ' || k)
    RETURNING id INTO v_id;
    vconvs := vconvs || v_id;
    INSERT INTO public.chat_visitors (conversation_id, organization_id, website_id, name, email, phone)
    VALUES (v_id, o, w, 'Vic ' || m, m || '-visitor@test.local', '+1555000200' || k);
    INSERT INTO public.chat_messages (conversation_id, organization_id, kind, sender_label, body_ciphertext)
    VALUES (v_id, o, 'visitor', 'Vic ' || m, private.chat_encrypt(m || ' visitor secret', private.chat_key(1)));

    INSERT INTO public.organization_invitations (organization_id, email, role)
    VALUES (o, m || '-invitee@test.local', 'viewer')
    RETURNING id INTO v_id;
    invs := invs || v_id;

    BEGIN
      INSERT INTO public.contracts (organization_id, template_key, template_version, title, body, status, document_hash, sent_at)
      VALUES (o, 'msa', 1, 'Iso contract ' || k, m || ' contract body', 'sent', repeat('a', 64), now())
      RETURNING id INTO v_id;
      contracts[k] := v_id;
    EXCEPTION WHEN OTHERS THEN
      notes := notes || ('SETUP contracts: ' || SQLERRM);
    END;

    -- Optional rows (one per remaining tenant table); a failure is only a note.
    DECLARE
      q text;
    BEGIN
      FOREACH q IN ARRAY ARRAY[
        format('INSERT INTO public.website_settings (website_id, organization_id, key, value, is_public) VALUES (%L, %L, %L, to_jsonb(%L::text), false)', w, o, 'private.note', m || ' private setting'),
        format('INSERT INTO public.content_blocks (website_id, organization_id, page, block_key, data, status) VALUES (%L, %L, %L, %L, jsonb_build_object(%L, %L), %L)', w, o, 'home', 'hero', 't', m || ' draft block', 'draft'),
        format('INSERT INTO public.announcements (website_id, organization_id, slug, title, status) VALUES (%L, %L, %L, %L, %L)', w, o, m || '-news', m || ' news', 'draft'),
        format('INSERT INTO public.faq_items (website_id, organization_id, question, answer, status) VALUES (%L, %L, %L, %L, %L)', w, o, m || ' q', m || ' a', 'draft'),
        format('INSERT INTO public.gallery_items (website_id, organization_id, title, image_url, status) VALUES (%L, %L, %L, %L, %L)', w, o, m || ' g', '/' || m || '.jpg', 'draft'),
        format('INSERT INTO public.reviews (website_id, organization_id, author, comment, status) VALUES (%L, %L, %L, %L, %L)', w, o, 'Rev ' || m, m || ' comment', 'draft'),
        format('INSERT INTO public.services (website_id, organization_id, slug, name, status) VALUES (%L, %L, %L, %L, %L)', w, o, m || '-svc', m || ' service', 'draft'),
        format('INSERT INTO public.team_members (website_id, organization_id, slug, name, email, status) VALUES (%L, %L, %L, %L, %L, %L)', w, o, m || '-tm', m || ' member', m || '-staff@test.local', 'draft'),
        format('INSERT INTO public.showcase_projects (website_id, organization_id, slug, name, url, status) VALUES (%L, %L, %L, %L, %L, %L)', w, o, m || '-p', m || ' project', '/' || m, 'draft'),
        format('INSERT INTO public.showcase_templates (website_id, organization_id, slug, name, url, status) VALUES (%L, %L, %L, %L, %L, %L)', w, o, m || '-t', m || ' template', 'https://' || m || '.test', 'draft'),
        -- showcase sections have no status (public on a live site): neutral text
        format('INSERT INTO public.showcase_sections (website_id, organization_id, page, section_key) VALUES (%L, %L, %L, %L)', w, o, 'home', 'iso-intro'),
        -- media_storage: the file is stored first (new layout), then registered.
        format('INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES (%L, %L, %L, %L::jsonb)', 'media', 'org/' || o || '/site/' || w || '/2026/10/' || md5(m)::uuid || '.jpg', u, '{"size": 1, "mimetype": "image/jpeg"}'),
        format('INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by) VALUES (%L, %L, %L, %L, %L, 1, %L)', o, w, 'org/' || o || '/site/' || w || '/2026/10/' || md5(m)::uuid || '.jpg', m || '.jpg', 'image/jpeg', u),
        format('INSERT INTO public.site_audit_log (website_id, organization_id, action, metadata) VALUES (%L, %L, %L, jsonb_build_object(%L, %L))', w, o, 'api_key.created', 'note', m),
        format('INSERT INTO public.site_traffic_daily (website_id, organization_id, day, views, visitors) VALUES (%L, %L, current_date, %s, 1)', w, o, num[k]),
        format('INSERT INTO public.site_pageviews_daily (website_id, organization_id, day, path, views) VALUES (%L, %L, current_date, %L, %s)', w, o, '/' || m, num[k]),
        format('INSERT INTO public.ai_usage (organization_id, feature, count) VALUES (%L, %L, %s)', o, 'assistant', 7),
        format('INSERT INTO public.organization_required_tasks (organization_id, task) VALUES (%L, %L)', o, 'profile'),
        format('INSERT INTO public.organization_billing (organization_id, plan_key, billing_note) VALUES (%L, %L, %L)', o, v_plan, m || ' billing note'),
        format('INSERT INTO public.billing_charges (organization_id, label, kind, base_amount, currency) VALUES (%L, %L, %L, %s, %L)', o, m || ' charge', 'one_off', num[k], 'usd'),
        format('INSERT INTO public.discounts (organization_id, label, kind, value) VALUES (%L, %L, %L, 10)', o, m || ' discount', 'percent'),
        format('INSERT INTO public.discount_redemptions (discount_id, organization_id) SELECT id, organization_id FROM public.discounts WHERE organization_id = %L LIMIT 1', o),
        format('INSERT INTO public.plan_upgrade_requests (organization_id, plan_key, message) VALUES (%L, %L, %L)', o, v_plan, m || ' upgrade'),
        format('INSERT INTO public.access_requests (user_id, business_name, organization_id, phone) VALUES (%L, %L, %L, %L)', members[k], m || ' business', o, '+1555000300' || k),
        format('INSERT INTO public.legal_acceptances (user_id, version, source) VALUES (%L, %L, %L)', u, '2026-01-01', 'signup'),
        format('INSERT INTO public.contract_signatures (contract_id, organization_id, signer_email, signer_name, signer_title, consent, document_hash, user_id) VALUES (%L, %L, %L, %L, %L, true, %L, %L)', contracts[k], o, m || '-signer@test.local', 'Signer ' || m, 'CEO', repeat('a', 64), u),
        format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)', 'media', o || '/' || w || '/' || m || '-file.jpg', u),
        format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)', 'brand', 'orgs/' || o || '/logo.webp', u),
        format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)', 'contracts', o || '/' || coalesce(contracts[k]::text, gen_random_uuid()::text) || '.pdf', u)
      ] LOOP
        BEGIN
          EXECUTE q;
        EXCEPTION WHEN OTHERS THEN
          notes := notes || ('SETUP ' || left(q, 60) || '...: ' || SQLERRM);
        END;
      END LOOP;
    END;
  END LOOP;

  -- LevelStudio users (no organization)
  INSERT INTO public.studio_projects (user_id, title, messages, html, share_token)
  VALUES (s1, 'zzs1 project', '[]', '<p>zzs1</p>', md5(random()::text)),
         (s2, 'zzs2 project', '[]', '<p>zzs2</p>', md5(random()::text));
  INSERT INTO public.studio_templates (id, name, kind, owner_user_id, is_published)
  VALUES ('iso-imp-' || substr(md5(random()::text), 1, 12), 'zzs1 import', 'import', s1, false),
         ('iso-imp-' || substr(md5(random()::text), 1, 12), 'zzs2 import', 'import', s2, false);

  -- Platform admins: p1 has a verified authenticator app, p2 none.
  INSERT INTO public.platform_admins (user_id) VALUES (p1), (p2);
  BEGIN
    INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
    VALUES (gen_random_uuid(), p1, 'iso', 'totp', 'verified', now(), now(), 'ISOTESTSECRET');
  EXCEPTION WHEN OTHERS THEN
    notes := notes || ('SETUP mfa_factors: ' || SQLERRM);
  END;

  results := results || (CASE WHEN array_length(orgs, 1) = 2 AND array_length(sites, 1) = 2 THEN 'PASS' ELSE 'FAIL' END || ' fixtures created');

  -- ===================================== table probes (computed as postgres)
  -- A's owner -> B
  pub := pg_temp.public_counts(orgs[2], false, 'authenticated');
  DECLARE outside jsonb := pg_temp.public_counts(orgs[1], true, 'authenticated');
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', owners[1], 'role', 'authenticated', 'aal', 'aal1')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    results := results || pg_temp.probe('A owner -> B:', orgs[2], pub, orgs[1], outside);
    EXECUTE 'RESET ROLE';
  END;

  -- B's editor -> A
  pub := pg_temp.public_counts(orgs[1], false, 'authenticated');
  DECLARE outside jsonb := pg_temp.public_counts(orgs[2], true, 'authenticated');
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', members[2], 'role', 'authenticated', 'aal', 'aal1')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    results := results || pg_temp.probe('B editor -> A:', orgs[1], pub, orgs[2], outside);
    EXECUTE 'RESET ROLE';
  END;

  -- anon -> B, and nothing of any tenant beyond public content
  pub := pg_temp.public_counts(orgs[2], false, 'anon');
  DECLARE outside jsonb := pg_temp.public_counts(NULL, true, 'anon');
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    results := results || pg_temp.probe('anon -> B:', orgs[2], pub, NULL, outside);
    EXECUTE 'RESET ROLE';
  END;

  -- LevelStudio user 1 sees no organization data at all
  DECLARE outside jsonb := pg_temp.public_counts(NULL, true, 'authenticated');
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    results := results || pg_temp.probe('studio user -> B:', orgs[2], pg_temp.public_counts(orgs[2], false, 'authenticated'), NULL, outside);
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    results := results || ('FAIL studio user probe error ' || SQLERRM);
  END;

  -- ========================================================= as A's owner
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owners[1], 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT count(*) INTO n FROM public.organizations WHERE id <> orgs[1];
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' A sees no other organization (' || n || ')');
  SELECT count(*) INTO n FROM public.profiles
  WHERE id <> owners[1] AND id NOT IN (SELECT user_id FROM public.organization_members WHERE organization_id = orgs[1]);
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' A sees only co-member profiles (' || n || ' others)');
  results := results || pg_temp.judge('A: foreign platform_admins rows', pg_temp.foreign_rows('platform_admins', 'user_id', owners[1]), false, NULL, '^(0|ERR.*)$');
  results := results || pg_temp.judge('A: foreign hq_staff rows', pg_temp.foreign_rows('hq_staff', 'user_id', owners[1]), false, NULL, '^0$');
  results := results || pg_temp.judge('A: foreign legal_acceptances rows', pg_temp.foreign_rows('legal_acceptances', 'user_id', owners[1]), false, NULL, '^0$');
  results := results || pg_temp.judge('A: foreign access_requests rows', pg_temp.foreign_rows('access_requests', 'user_id', owners[1]), false, NULL, '^0$');
  results := results || pg_temp.judge('A: foreign chat_participants rows', pg_temp.foreign_rows('chat_participants', 'user_id', owners[1]), false, NULL, '^0$');
  SELECT count(*) INTO n FROM public.studio_projects;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' A sees no LevelStudio project (' || n || ')');

  -- direct inserts into B
  results := results || pg_temp.judge('A insert member into B', pg_temp.try(format(
    'INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (%L, %L, %L) RETURNING user_id::text', orgs[2], owners[1], 'viewer')), true, NULL);
  results := results || pg_temp.judge('A insert invitation into B', pg_temp.try(format(
    'INSERT INTO public.organization_invitations (organization_id, email, role) VALUES (%L, %L, %L) RETURNING id::text', orgs[2], 'evil@test.local', 'owner')), true, NULL);
  results := results || pg_temp.judge('A insert announcement into B', pg_temp.try(format(
    'INSERT INTO public.announcements (website_id, organization_id, slug, title, status) VALUES (%L, %L, %L, %L, %L) RETURNING id::text', sites[2], orgs[2], 'evil', 'Evil', 'published')), true, NULL);
  results := results || pg_temp.judge('A insert announcement on B site under own org', pg_temp.try(format(
    'INSERT INTO public.announcements (website_id, organization_id, slug, title, status) VALUES (%L, %L, %L, %L, %L) RETURNING id::text', sites[2], orgs[1], 'evil', 'Evil', 'published')), true, NULL);
  results := results || pg_temp.judge('A insert website setting into B', pg_temp.try(format(
    'INSERT INTO public.website_settings (website_id, organization_id, key, value, is_public) VALUES (%L, %L, %L, %L, true) RETURNING key', sites[2], orgs[2], 'contact', '"evil"')), true, NULL);
  results := results || pg_temp.judge('A insert appointment into B', pg_temp.try(format(
    'INSERT INTO public.appointments (website_id, organization_id, ticket_code, customer_name, appointment_date, appointment_time) VALUES (%L, %L, %L, %L, current_date, %L) RETURNING id::text', sites[2], orgs[2], 'EV-ABCDEFGH', 'Evil', '10:00')), true, NULL);
  results := results || pg_temp.judge('A insert waitlist entry into B', pg_temp.try(format(
    'INSERT INTO public.waitlist_entries (website_id, organization_id, ticket_code, customer_name, position) VALUES (%L, %L, %L, %L, 1) RETURNING id::text', sites[2], orgs[2], 'EV-ABCDEFGH', 'Evil')), true, NULL);
  results := results || pg_temp.judge('A insert media row into B', pg_temp.try(format(
    'INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by) VALUES (%L, %L, %L, %L, %L, 1, %L) RETURNING id::text', orgs[2], sites[2], orgs[2] || '/' || sites[2] || '/evil.jpg', 'evil.jpg', 'image/jpeg', owners[1])), true, NULL);
  results := results || pg_temp.judge('A update B website via own org id', pg_temp.try(format(
    'UPDATE public.websites SET name = %L WHERE id = %L RETURNING id', 'hacked', sites[2])), false, NULL, '^<null>$');

  -- Storage
  results := results || pg_temp.judge('A list B storage objects', pg_temp.try(format(
    'SELECT count(*)::text FROM storage.objects WHERE name LIKE %L OR name LIKE %L OR name LIKE %L', orgs[2] || '/%', 'orgs/' || orgs[2] || '/%', 'org/' || orgs[2] || '/%')), false, NULL, '^0$');
  SELECT count(*) INTO n FROM storage.objects
  WHERE bucket_id IN ('media', 'contracts')
    AND coalesce(private.media_object_org(name)::text, split_part(name, '/', 1)) <> orgs[1]::text;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' A lists no other tenant file in media / contracts (' || n || ')');
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'brand';
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' brand bucket cannot be listed (' || n || ')');
  results := results || pg_temp.judge('A upload into B media folder', pg_temp.try(format(
    'INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L) RETURNING id::text', 'media', orgs[2] || '/' || sites[2] || '/evil.jpg', owners[1])), true, NULL);
  results := results || pg_temp.judge('A upload into own org folder with B website', pg_temp.try(format(
    'INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L) RETURNING id::text', 'media', orgs[1] || '/' || sites[2] || '/evil.jpg', owners[1])), true, NULL);
  results := results || pg_temp.judge('A overwrite B logo', pg_temp.try(format(
    'INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L) RETURNING id::text', 'brand', 'orgs/' || orgs[2] || '/logo.webp', owners[1])), true, NULL);
  results := results || pg_temp.judge('A write B owner avatar', pg_temp.try(format(
    'INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L) RETURNING id::text', 'brand', 'avatars/' || owners[2] || '/a.webp', owners[1])), true, NULL);
  results := results || pg_temp.judge('A upload B contract PDF', pg_temp.try(format(
    'INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L) RETURNING id::text', 'contracts', orgs[2] || '/' || coalesce(contracts[2]::text, gen_random_uuid()::text) || '.pdf', owners[1])), true, NULL);
  results := results || pg_temp.judge('A rename B storage objects', pg_temp.try(format(
    'WITH x AS (UPDATE storage.objects SET name = name WHERE name LIKE %L OR name LIKE %L RETURNING 1) SELECT count(*)::text FROM x', orgs[2] || '/%', 'orgs/' || orgs[2] || '/%')), false, NULL, '^0$');

  -- RPCs with B's ids (markers: B's PII and amounts)
  DECLARE
    bm text[] := ARRAY['zzb', '4242'];
    c record;
  BEGIN
    FOR c IN SELECT * FROM (VALUES
      ('site_payments_list', format('SELECT public.site_payments_list(%L, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 50, 0)::text', sites[2]), false, NULL::text),
      ('site_payment_detail', format('SELECT public.site_payment_detail(%L::uuid)::text', pays[2]), false, NULL),
      ('site_payments_export', format('SELECT public.site_payments_export(%L, NULL, NULL, NULL, NULL)::text', sites[2]), false, NULL),
      ('site_payments_summary', format('SELECT public.site_payments_summary(%L, 30, NULL)::text', sites[2]), false, NULL),
      ('site_analytics_summary', format('SELECT public.site_analytics_summary(%L, 30)::text', sites[2]), false, NULL),
      ('site_capabilities', format('SELECT public.site_capabilities(%L)::text', sites[2]), false, '^(<null>|[^1-9]*)$'),
      ('site_overview_stats', format('SELECT public.site_overview_stats(%L, 30)::text', sites[2]), false, NULL),
      ('site_recent_activity', format('SELECT public.site_recent_activity(%L, 50)::text', sites[2]), false, '^(\[\]|<null>)$'),
      ('site_submissions_list', format('SELECT public.site_submissions_list(%L, NULL, NULL, NULL, 50, 0)::text', sites[2]), false, '"total": 0'),
      ('site_project_requests_list', format('SELECT public.site_project_requests_list(%L, NULL, NULL, NULL, 50, 0)::text', sites[2]), false, NULL),
      ('site_project_requests_stats', format('SELECT public.site_project_requests_stats(%L, 30)::text', sites[2]), false, NULL),
      ('site_studio_summary', format('SELECT public.site_studio_summary(%L, 30)::text', sites[2]), false, '^<null>$'),
      ('site_owned_source_counts', format('SELECT public.site_owned_source_counts(%L)::text', sites[2]), false, NULL),
      ('site_owned_activity', format('SELECT public.site_owned_activity(%L)::text', sites[2]), false, '^(\[\]|<null>)$'),
      ('site_update_project_request', format('SELECT public.site_update_project_request(%L, gen_random_uuid(), %L, NULL)::text', sites[2], 'won'), true, NULL),
      ('site_create_api_key', format('SELECT public.site_create_api_key(%L, %L, %L, %L::text[])::text', sites[2], 'evil', 'test', '{payments:write}'), true, NULL),
      ('site_revoke_api_key', format('SELECT public.site_revoke_api_key(%L::uuid)::text', keys[2]), true, NULL),
      ('chat_list_conversations', format('SELECT public.chat_list_conversations(%L::uuid, true)::text', orgs[2]), true, NULL),
      ('chat_list_members', format('SELECT public.chat_list_members(%L::uuid)::text', orgs[2]), true, NULL),
      ('chat_unread_total', format('SELECT public.chat_unread_total(%L::uuid)::text', orgs[2]), false, '^0$'),
      ('chat_open_direct', format('SELECT public.chat_open_direct(%L::uuid, %L::uuid)::text', orgs[2], owners[2]), true, NULL),
      ('chat_list_messages', format('SELECT public.chat_list_messages(%L::uuid, NULL, NULL, NULL, 50)::text', convs[2]), false, NULL),
      ('chat_list_messages visitor', format('SELECT public.chat_list_messages(%L::uuid, NULL, NULL, NULL, 50)::text', vconvs[2]), false, NULL),
      ('chat_get_message', format('SELECT public.chat_get_message(%L::uuid)::text', msgs[2]), false, NULL),
      ('chat_send_message', format('SELECT public.chat_send_message(%L::uuid, %L, NULL, NULL)::text', convs[2], 'evil'), true, NULL),
      ('chat_edit_message', format('SELECT public.chat_edit_message(%L::uuid, %L)::text', msgs[2], 'evil'), true, NULL),
      ('chat_delete_message', format('SELECT public.chat_delete_message(%L::uuid)::text', msgs[2]), true, NULL),
      ('chat_mark_read', format('SELECT public.chat_mark_read(%L::uuid)::text', convs[2]), true, NULL),
      ('chat_set_muted', format('SELECT public.chat_set_muted(%L::uuid, true)::text', convs[2]), true, NULL),
      ('chat_set_visitor_status', format('SELECT public.chat_set_visitor_status(%L::uuid, %L)::text', vconvs[2], 'archived'), true, NULL),
      ('chat_visitor_contact', format('SELECT public.chat_visitor_contact(%L::uuid)::text', vconvs[2]), true, NULL),
      ('add_organization_member', format('SELECT public.add_organization_member(%L::uuid, %L, %L)::text', orgs[2], 'iso-viewer-a@test.local', 'admin'), true, NULL),
      ('create_organization_invitation', format('SELECT public.create_organization_invitation(%L::uuid, %L, %L)::text', orgs[2], 'evil@test.local', 'admin'), true, NULL),
      ('resend_organization_invitation', format('SELECT public.resend_organization_invitation(%L::uuid)::text', invs[2]), true, NULL),
      ('revoke_organization_invitation', format('SELECT public.revoke_organization_invitation(%L::uuid)::text', invs[2]), true, NULL),
      ('record_organization_invitation_email', format('SELECT public.record_organization_invitation_email(%L::uuid, true)::text', invs[2]), true, NULL),
      ('assistant_consume', format('SELECT public.assistant_consume(%L::uuid, 60)::text', orgs[2]), true, NULL),
      ('billing_summary', format('SELECT public.billing_summary(%L::uuid)::text', orgs[2]), true, NULL),
      ('billing_usage', format('SELECT public.billing_usage(%L::uuid)::text', orgs[2]), true, NULL),
      ('redeem_discount_code', format('SELECT public.redeem_discount_code(%L::uuid, %L)::text', orgs[2], 'ISO-CODE'), true, NULL),
      ('request_plan_upgrade', format('SELECT public.request_plan_upgrade(%L::uuid, %L, %L)::text', orgs[2], coalesce(v_plan, 'x'), 'evil'), true, NULL),
      ('org_access_state', format('SELECT public.org_access_state(%L::uuid)::text', orgs[2]), false, '^<null>$'),
      ('dashboard_access', format('SELECT public.dashboard_access(%L::uuid)::text', orgs[2]), false, NULL),
      ('mark_contract_emailed', format('SELECT public.mark_contract_emailed(%L::uuid)::text', coalesce(contracts[2], gen_random_uuid())), false, '^false$'),
      ('sign_contract', format('SELECT public.sign_contract(%L::uuid, %L, %L, NULL, true, %L)::text', coalesce(contracts[2], gen_random_uuid()), 'Evil Signer', 'CEO', repeat('a', 64)), true, NULL),
      ('admin_get_org_billing', format('SELECT public.admin_get_org_billing(%L::uuid)::text', orgs[2]), true, NULL),
      ('admin_get_site_access', format('SELECT public.admin_get_site_access(%L)::text', sites[2]), true, NULL),
      ('admin_update_website', format('SELECT public.admin_update_website(%L, %L, NULL, NULL, NULL, NULL)::text', sites[2], 'suspended'), true, NULL),
      ('admin_list_access_requests', 'SELECT public.admin_list_access_requests()::text', true, NULL),
      ('admin_list_billing_orgs', 'SELECT public.admin_list_billing_orgs()::text', true, NULL),
      ('hq_get_client', format('SELECT public.hq_get_client(%L::uuid)::text', orgs[2]), true, NULL),
      ('hq_list_clients', 'SELECT public.hq_list_clients(NULL, NULL, NULL, 1, 20, NULL)::text', true, NULL),
      ('ai_usage_summary', 'SELECT public.ai_usage_summary(30)::text', true, NULL)
    ) AS t(label, q, must_refuse, ok_regex) LOOP
      results := results || pg_temp.judge('A -> B rpc ' || c.label, pg_temp.try(c.q), c.must_refuse,
        bm || CASE WHEN c.label = 'dashboard_access' THEN orgs[2]::text END, c.ok_regex);
    END LOOP;
  END;

  -- positive controls: the same calls work on A's own ids
  results := results || pg_temp.judge('control: A lists own payments (PII for owner)', pg_temp.try(format(
    'SELECT public.site_payments_list(%L, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 50, 0)::text', sites[1])), false, NULL, 'zza-cust@test\.local');
  results := results || pg_temp.judge('control: A lists own submissions', pg_temp.try(format(
    'SELECT public.site_submissions_list(%L, NULL, NULL, NULL, 50, 0)::text', sites[1])), false, NULL, 'zza-lead');
  results := results || pg_temp.judge('control: A lists own conversations', pg_temp.try(format(
    'SELECT public.chat_list_conversations(%L::uuid, true)::text', orgs[1])), false, NULL, 'zza');
  results := results || pg_temp.judge('control: A reads own team message', pg_temp.try(format(
    'SELECT public.chat_get_message(%L::uuid)::text', msgs[1])), false, NULL, 'zza team secret');
  results := results || pg_temp.judge('control: A billing summary', pg_temp.try(format(
    'SELECT public.billing_summary(%L::uuid)::text', orgs[1])), false, NULL, '.');
  results := results || pg_temp.judge('control: A sees own form submission row', pg_temp.try(format(
    'SELECT count(*)::text FROM public.form_submissions WHERE organization_id = %L', orgs[1])), false, NULL, '^[1-9]');
  EXECUTE 'RESET ROLE';

  -- B's state is untouched (as postgres)
  SELECT count(*) INTO n FROM public.site_api_keys WHERE organization_id = orgs[2] AND revoked_at IS NULL;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' B api key still active, no key added (' || n || ')');
  SELECT count(*) INTO n FROM public.organization_members WHERE organization_id = orgs[2];
  results := results || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL' END || ' B members unchanged (' || n || ')');
  SELECT count(*) INTO n FROM public.chat_messages WHERE organization_id = orgs[2] AND deleted_at IS NULL AND edited_at IS NULL;
  results := results || (CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL' END || ' B chat messages unchanged (' || n || ')');
  SELECT count(*) INTO n FROM public.organization_invitations WHERE organization_id = orgs[2] AND revoked_at IS NULL;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' B invitations unchanged (' || n || ')');

  -- ===================================================== viewer masking (A)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', members[1], 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  results := results || pg_temp.judge('viewer: payments list masks customer e-mail', pg_temp.try(format(
    'SELECT public.site_payments_list(%L, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 50, 0)::text', sites[1])), false, ARRAY['zza-cust@test.local'], '1111');
  results := results || pg_temp.judge('viewer: payment detail masks customer e-mail', pg_temp.try(format(
    'SELECT public.site_payment_detail(%L::uuid)::text', pays[1])), false, ARRAY['zza-cust@test.local'], '1111');
  results := results || pg_temp.judge('viewer: no customer columns on site_payments', pg_temp.try(format(
    'SELECT customer_email FROM public.site_payments WHERE id = %L', pays[1])), true, NULL);
  results := results || pg_temp.judge('viewer: payments export refused', pg_temp.try(format(
    'SELECT public.site_payments_export(%L, NULL, NULL, NULL, NULL)::text', sites[1])), true, NULL);
  results := results || pg_temp.judge('viewer: chat visitor contact refused', pg_temp.try(format(
    'SELECT public.chat_visitor_contact(%L::uuid)::text', vconvs[1])), true, NULL);
  results := results || pg_temp.judge('viewer: conversation list masks visitor e-mail', pg_temp.try(format(
    'SELECT public.chat_list_conversations(%L::uuid, true)::text', orgs[1])), false, ARRAY['zza-visitor@test.local'], 'Vic zza');
  results := results || pg_temp.judge('viewer: cannot read api key hashes', pg_temp.try(format(
    'SELECT key_hash FROM public.site_api_keys WHERE organization_id = %L', orgs[1])), true, NULL);
  EXECUTE 'RESET ROLE';

  -- ================================================================== anon
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  DECLARE
    c record;
  BEGIN
    FOR c IN SELECT * FROM (VALUES
      ('site_payments_list', format('SELECT public.site_payments_list(%L, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 50, 0)::text', sites[2])),
      ('site_payment_detail', format('SELECT public.site_payment_detail(%L::uuid)::text', pays[2])),
      ('site_submissions_list', format('SELECT public.site_submissions_list(%L, NULL, NULL, NULL, 50, 0)::text', sites[2])),
      ('site_recent_activity', format('SELECT public.site_recent_activity(%L, 50)::text', sites[2])),
      ('chat_list_conversations', format('SELECT public.chat_list_conversations(%L::uuid, true)::text', orgs[2])),
      ('chat_list_messages', format('SELECT public.chat_list_messages(%L::uuid, NULL, NULL, NULL, 50)::text', convs[2])),
      ('chat_visitor_contact', format('SELECT public.chat_visitor_contact(%L::uuid)::text', vconvs[2])),
      ('billing_summary', format('SELECT public.billing_summary(%L::uuid)::text', orgs[2])),
      ('add_organization_member', format('SELECT public.add_organization_member(%L::uuid, %L, %L)::text', orgs[2], 'x@test.local', 'owner')),
      ('assistant_consume', format('SELECT public.assistant_consume(%L::uuid, 60)::text', orgs[2])),
      ('site_create_api_key', format('SELECT public.site_create_api_key(%L, %L, %L, %L::text[])::text', sites[2], 'evil', 'test', '{payments:write}')),
      ('accept_organization_invitation', format('SELECT public.accept_organization_invitation(%L)::text', repeat('a', 43))),
      ('studio_consume_usage', 'SELECT public.studio_consume_usage(current_date, ARRAY[''owner:x''], false)::text')
    ) AS t(label, q) LOOP
      results := results || pg_temp.judge('anon rpc ' || c.label, pg_temp.try(c.q), true, NULL);
    END LOOP;
  END;
  results := results || pg_temp.judge('anon: public website of B hides private settings', pg_temp.try(format(
    'SELECT public.get_public_website(%L)::text', sites[2])), false, ARRAY['zzb'], sites[2]);
  results := results || pg_temp.judge('anon: site bundle of B hides drafts', pg_temp.try(format(
    'SELECT public.get_site_bundle(%L)::text', sites[2])), false, ARRAY['zzb'], sites[2]);
  results := results || pg_temp.judge('anon: public waitlist of B hides contact details', pg_temp.try(format(
    'SELECT public.get_public_waitlist(%L)::text', sites[2])), false, ARRAY['zzb', '@'], NULL);
  results := results || pg_temp.judge('anon: B ticket looked up on A website', pg_temp.try(format(
    'SELECT public.get_ticket_status(%L, %L)::text', sites[1], tickets[2])), false, ARRAY['zzb'], '^<null>$');
  results := results || pg_temp.judge('anon: unknown invitation token', pg_temp.try(format(
    'SELECT public.get_organization_invitation(%L)::text', repeat('a', 43))), false, ARRAY['zzb'], 'invalid');
  results := results || pg_temp.judge('anon: storage objects not listable', pg_temp.try(
    'SELECT count(*)::text FROM storage.objects'), false, NULL, '^0$');
  results := results || pg_temp.judge('anon: upload into B media folder', pg_temp.try(format(
    'INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L) RETURNING id::text', 'media', orgs[2] || '/' || sites[2] || '/evil.jpg')), true, NULL);
  results := results || pg_temp.judge('anon: studio projects', pg_temp.try('SELECT count(*)::text FROM public.studio_projects'), false, NULL, '^(0|ERR.*)$');
  EXECUTE 'RESET ROLE';

  -- ============================================================ LevelStudio
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.studio_projects WHERE user_id = s1;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' studio 1 reads own project (' || n || ')');
  results := results || pg_temp.judge('studio 1: projects of anyone else (real data included)',
    pg_temp.foreign_rows('studio_projects', 'user_id', s1), false, NULL, '^0$');
  results := results || pg_temp.judge('studio 1: update studio 2 project', pg_temp.try(format(
    'WITH x AS (UPDATE public.studio_projects SET title = %L WHERE user_id = %L RETURNING 1) SELECT count(*)::text FROM x', 'hacked', s2)), false, NULL, '^0$');
  results := results || pg_temp.judge('studio 1: delete studio 2 project', pg_temp.try(format(
    'WITH x AS (DELETE FROM public.studio_projects WHERE user_id = %L RETURNING 1) SELECT count(*)::text FROM x', s2)), false, NULL, '^0$');
  results := results || pg_temp.judge('studio 1: insert project for studio 2', pg_temp.try(format(
    'INSERT INTO public.studio_projects (user_id, title) VALUES (%L, %L) RETURNING id::text', s2, 'evil')), true, NULL);
  results := results || pg_temp.judge('studio 1: studio 2 imported templates', pg_temp.try(format(
    'SELECT count(*)::text FROM public.studio_templates WHERE owner_user_id = %L', s2)), false, NULL, '^0$');
  results := results || pg_temp.judge('studio 1: imported templates of anyone else', pg_temp.try(format(
    'SELECT count(*)::text FROM public.studio_templates WHERE kind = %L AND owner_user_id IS DISTINCT FROM %L', 'import', s1)), false, NULL, '^0$');
  results := results || pg_temp.judge('studio 1: studio 2 share token lookup', pg_temp.try(
    'SELECT count(*)::text FROM public.studio_projects WHERE share_token IS NOT NULL AND user_id IS DISTINCT FROM auth.uid()'), false, NULL, '^0$');
  results := results || pg_temp.judge('studio 1: studio_usage', pg_temp.try('SELECT count(*)::text FROM public.studio_usage'), false, NULL, '^(0|ERR.*)$');
  results := results || pg_temp.judge('studio 1: studio_rate_limits', pg_temp.try('SELECT count(*)::text FROM public.studio_rate_limits'), false, NULL, '^(0|ERR.*)$');
  results := results || pg_temp.judge('studio 1: studio_assets', pg_temp.try('SELECT count(*)::text FROM public.studio_assets'), false, NULL, '^(0|ERR.*)$');
  results := results || pg_temp.judge('studio 1: studio_image_cache', pg_temp.try('SELECT count(*)::text FROM public.studio_image_cache'), false, NULL, '^(0|ERR.*)$');
  results := results || pg_temp.judge('studio 1: studio_project_limits', pg_temp.try('SELECT count(*)::text FROM public.studio_project_limits'), false, NULL, '^(0|ERR.*)$');
  results := results || pg_temp.judge('studio 1: consume usage for studio 2', pg_temp.try(format(
    'SELECT public.studio_consume_usage(current_date, ARRAY[%L], false)::text', 'owner:' || s2)), true, NULL);
  results := results || pg_temp.judge('studio 1: project allowance', pg_temp.try(format(
    'SELECT public.studio_project_allowance(%L::uuid, NULL)::text', s2)), true, NULL);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s2, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.studio_projects WHERE user_id = s1;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' studio 2 cannot read studio 1 project (' || n || ')');
  SELECT count(*) INTO n FROM public.studio_projects WHERE title = 'zzs2 project';
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' studio 2 project intact (' || n || ')');
  EXECUTE 'RESET ROLE';

  -- ===================================================== platform admins
  -- p1 has a verified factor: on aal1 (stolen password) no tenant data.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.form_submissions WHERE organization_id = orgs[2];
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' platform admin on aal1 (has MFA) reads no tenant submissions (' || n || ')');
  SELECT count(*) INTO n FROM public.organizations WHERE id = ANY (orgs);
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' platform admin on aal1 (has MFA) sees no client organization (' || n || ')');
  results := results || pg_temp.judge('platform admin on aal1: admin RPC', pg_temp.try('SELECT public.admin_list_access_requests()::text'), true, NULL);
  EXECUTE 'RESET ROLE';

  -- p2 never enrolled MFA: platform powers still need an aal2 session.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p2, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.form_submissions WHERE organization_id = orgs[2];
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' platform admin without MFA (aal1) reads no tenant submissions (' || n || ')');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.form_submissions WHERE organization_id = orgs[2];
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' control: platform admin on aal2 keeps staff access (' || n || ')');
  EXECUTE 'RESET ROLE';

  -- ================================================================ report
  SELECT count(*) INTO failed FROM unnest(results) r WHERE r LIKE 'FAIL%';
  RAISE EXCEPTION E'TENANT ISOLATION REPORT (rolled back): % failed / % total\n%\n--- notes ---\n%',
    failed, array_length(results, 1),
    array_to_string(ARRAY(SELECT r FROM unnest(results) r ORDER BY (r LIKE 'FAIL%') DESC), E'\n'),
    coalesce(array_to_string(notes, E'\n'), '');
END;
$$;
