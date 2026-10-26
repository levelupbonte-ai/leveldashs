-- Media storage (migration media_storage): object layout, upload rights, storage
-- isolation between organizations, the trusted media index, cursor pagination,
-- per-website stats and org_storage_usage. Always rolls back; the exception
-- message is the report and must show `0 failed`.
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE
  u_a uuid := gen_random_uuid();   -- owner of org A
  u_e uuid := gen_random_uuid();   -- editor of org A
  u_v uuid := gen_random_uuid();   -- viewer of org A
  u_b uuid := gen_random_uuid();   -- owner of org B
  u_x uuid := gen_random_uuid();   -- signed in, no organization
  u_p uuid := gen_random_uuid();   -- LevelUp staff
  org_a uuid; org_b uuid; ws_a text; ws_b text; ws_arch text;
  base_a text; base_b text; pa text; pa_thumb text; pb text; p text; legacy_a text;
  c1 uuid; n integer; j jsonb; k jsonb; seen text[] := '{}'; r record; b boolean;
  results text[] := '{}';
  failed integer;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (u_a, 'a@t.l', 'authenticated', 'authenticated'), (u_e, 'e@t.l', 'authenticated', 'authenticated'),
    (u_v, 'v@t.l', 'authenticated', 'authenticated'), (u_b, 'b@t.l', 'authenticated', 'authenticated'),
    (u_x, 'x@t.l', 'authenticated', 'authenticated'), (u_p, 'p@t.l', 'authenticated', 'authenticated');
  INSERT INTO public.platform_admins (user_id) VALUES (u_p);
  INSERT INTO public.organizations (name, slug) VALUES ('Org A', 'zz-media-a') RETURNING id INTO org_a;
  INSERT INTO public.organizations (name, slug) VALUES ('Org B', 'zz-media-b') RETURNING id INTO org_b;
  INSERT INTO public.organization_members VALUES
    (org_a, u_a, 'owner'), (org_a, u_e, 'editor'), (org_a, u_v, 'viewer'), (org_b, u_b, 'owner');
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'Site A', 'active') RETURNING id INTO ws_a;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_b, 'Site B', 'active') RETURNING id INTO ws_b;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org_a, 'Old A', 'archived') RETURNING id INTO ws_arch;

  base_a := 'org/' || org_a || '/site/' || ws_a || '/2026/10/';
  base_b := 'org/' || org_b || '/site/' || ws_b || '/2026/10/';
  pa := base_a || gen_random_uuid() || '.webp';
  pa_thumb := replace(pa, '.webp', '_thumb.webp');
  pb := base_b || gen_random_uuid() || '.jpg';
  legacy_a := org_a || '/' || ws_a || '/old-hero.jpg';

  -- ---------- path rules ----------
  results := results || (CASE WHEN private.media_path_ok(pa) AND private.media_path_ok(pa_thumb) THEN 'PASS' ELSE 'FAIL' END || ' layout org/<org>/site/<site>/<yyyy>/<mm>/<uuid>.<ext> accepted');
  results := results || (CASE WHEN NOT private.media_path_ok(legacy_a) THEN 'PASS' ELSE 'FAIL' END || ' legacy layout not accepted for new files');
  results := results || (CASE WHEN NOT private.media_path_ok(base_a || gen_random_uuid() || '.svg')
    AND NOT private.media_path_ok(base_a || gen_random_uuid() || '.html')
    AND NOT private.media_path_ok(base_a || gen_random_uuid() || '.webp.html') THEN 'PASS' ELSE 'FAIL' END || ' svg / html / double extensions refused');
  results := results || (CASE WHEN NOT private.media_path_ok('org/' || org_a || '/site/' || ws_a || '/2026/13/' || gen_random_uuid() || '.png')
    AND NOT private.media_path_ok(base_a || '../' || gen_random_uuid() || '.png')
    AND NOT private.media_path_ok(base_a || 'hero.png')
    AND NOT private.media_path_ok(upper(pa)) THEN 'PASS' ELSE 'FAIL' END || ' bad month, traversal, non-uuid name, uppercase refused');
  results := results || (CASE WHEN private.media_object_org(pa) = org_a AND private.media_object_site(pa) = ws_a
    AND private.media_object_org(legacy_a) = org_a AND private.media_object_site(legacy_a) = ws_a THEN 'PASS' ELSE 'FAIL' END || ' org / site parsed from both layouts');

  -- Objects owned by others, created as postgres (as Storage would).
  INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES
    ('media', pb, u_b, '{"size": 4000, "mimetype": "image/jpeg"}'),
    ('media', legacy_a, u_a, '{"size": 50, "mimetype": "image/jpeg"}'),
    ('brand', 'orgs/' || org_a || '/logo.webp', u_a, '{"size": 20, "mimetype": "image/webp"}'),
    ('contracts', org_a || '/' || gen_random_uuid() || '.pdf', u_a, '{"size": 7, "mimetype": "application/pdf"}');

  -- ---------- editor of org A: uploads ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO storage.objects (bucket_id, name, owner, metadata)
  VALUES ('media', pa, u_e, '{"size": 1000, "mimetype": "image/webp"}'),
         ('media', pa_thumb, u_e, '{"size": 100, "mimetype": "image/webp"}');
  results := results || 'PASS editor uploads image + thumbnail in the new layout'::text;

  BEGIN INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('media', base_b || gen_random_uuid() || '.png', u_e);
    results := results || 'FAIL editor uploaded into org B'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS editor cannot upload into org B'::text; END;

  BEGIN INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('media', org_a || '/' || ws_a || '/new.png', u_e);
    results := results || 'FAIL legacy layout upload accepted'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS uploads must use the new layout'::text; END;

  BEGIN INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('media', 'org/' || org_a || '/site/' || ws_b || '/2026/10/' || gen_random_uuid() || '.png', u_e);
    results := results || 'FAIL org A path with org B website accepted'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS org / website mismatch refused'::text; END;

  BEGIN INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('media', base_a || gen_random_uuid() || '.svg', u_e);
    results := results || 'FAIL svg upload accepted'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS svg upload refused'::text; END;

  BEGIN INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('media', 'org/' || org_a || '/site/' || ws_arch || '/2026/10/' || gen_random_uuid() || '.png', u_e);
    results := results || 'FAIL upload to an archived website'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS no upload to an archived website'::text; END;

  UPDATE storage.objects SET metadata = '{"size": 1, "mimetype": "image/webp"}' WHERE bucket_id = 'media' AND name = pa;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' stored files are immutable (no overwrite / move)');

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'media';
  results := results || (CASE WHEN n = 3 THEN 'PASS' ELSE 'FAIL' END || ' editor lists only org A media objects (' || n || ')');
  results := results || (CASE WHEN private.can_access_media_path(legacy_a, 'editor') THEN 'PASS' ELSE 'FAIL' END || ' legacy files stay readable / deletable');

  -- ---------- media index ----------
  INSERT INTO public.media (organization_id, website_id, storage_path, thumb_path, filename, mime_type, size_bytes, width, height, alt_text, created_by)
  VALUES (org_a, ws_a, pa, pa_thumb, 'hero.webp', 'image/png', 1, 2400, 1600, 'Shop front', u_e);
  SELECT size_bytes, mime_type, thumb_size_bytes INTO r FROM public.media WHERE storage_path = pa;
  results := results || (CASE WHEN r.size_bytes = 1000 AND r.mime_type = 'image/webp' AND r.thumb_size_bytes = 100 THEN 'PASS' ELSE 'FAIL' END
    || ' size / type copied from Storage, not from the browser (' || r.size_bytes || ', ' || r.mime_type || ')');

  BEGIN INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
    VALUES (org_a, ws_a, base_a || gen_random_uuid() || '.png', 'ghost.png', 'image/png', 1, u_e);
    results := results || 'FAIL row without a stored file'::text;
  EXCEPTION WHEN invalid_parameter_value THEN results := results || 'PASS a row needs its stored file'::text; END;

  BEGIN INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
    VALUES (org_a, ws_a, legacy_a, 'old.jpg', 'image/jpeg', 50, u_e);
    results := results || 'FAIL new row with a legacy path'::text;
  EXCEPTION WHEN invalid_parameter_value THEN results := results || 'PASS new rows use the new layout'::text; END;

  BEGIN INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
    VALUES (org_a, ws_a, pb, 'b.jpg', 'image/jpeg', 1, u_e);
    results := results || 'FAIL row pointing at an org B file'::text;
  EXCEPTION WHEN check_violation THEN results := results || 'PASS a row cannot point at another tenant''s file'::text; END;

  BEGIN INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
    VALUES (org_a, ws_a, pa_thumb, 'thumb.webp', 'image/webp', 1, u_e);
    results := results || 'FAIL thumbnail registered as a library file'::text;
  EXCEPTION WHEN invalid_parameter_value THEN results := results || 'PASS thumbnails are not library files'::text; END;

  p := base_a || gen_random_uuid() || '.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('media', p, u_e, '{"size": 10, "mimetype": "image/png"}');
  BEGIN INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
    VALUES (org_a, ws_a, p, 'x.jpg', 'image/jpeg', 10, u_e);
    results := results || 'FAIL extension / type mismatch accepted'::text;
  EXCEPTION WHEN invalid_parameter_value THEN results := results || 'PASS extension must match the stored type'::text; END;

  BEGIN INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
    VALUES (org_a, ws_a, pa, 'dup.webp', 'image/webp', 1, u_e);
    results := results || 'FAIL same file registered twice'::text;
  EXCEPTION WHEN unique_violation THEN results := results || 'PASS one row per stored file'::text; END;

  UPDATE public.media SET alt_text = 'Front of the shop' WHERE storage_path = pa;
  GET DIAGNOSTICS n = ROW_COUNT;
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' editor edits alt text');
  BEGIN UPDATE public.media SET size_bytes = 1 WHERE storage_path = pa;
    results := results || 'FAIL size edited by a client'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS size / path / type not editable by clients'::text; END;

  -- Five more files (same transaction: same created_at, so the id breaks ties).
  FOR n IN 1..5 LOOP
    p := base_a || gen_random_uuid() || CASE WHEN n = 5 THEN '.pdf' ELSE '.webp' END;
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES ('media', p, u_e, json_build_object('size', 200, 'mimetype', CASE WHEN n = 5 THEN 'application/pdf' ELSE 'image/webp' END)::jsonb);
    INSERT INTO public.media (organization_id, website_id, storage_path, filename, mime_type, size_bytes, created_by)
    VALUES (org_a, ws_a, p, CASE WHEN n = 5 THEN 'menu_100%.pdf' ELSE 'photo-' || n || '.webp' END, 'x', 0, u_e);
  END LOOP;
  EXECUTE 'RESET ROLE';

  -- ---------- viewer of org A: reads ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_v, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  BEGIN INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('media', base_a || gen_random_uuid() || '.png', u_v);
    results := results || 'FAIL viewer uploaded'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS viewer cannot upload'::text; END;

  j := public.media_list(ws_a, NULL, NULL, NULL, NULL, 2);
  seen := ARRAY(SELECT x ->> 'id' FROM jsonb_array_elements(j -> 'rows') x);
  WHILE j -> 'next' <> 'null'::jsonb AND j -> 'next' IS NOT NULL AND array_length(seen, 1) < 20 LOOP
    k := j -> 'next';
    j := public.media_list(ws_a, NULL, NULL, (k ->> 'created_at')::timestamptz, (k ->> 'id')::uuid, 2);
    seen := seen || ARRAY(SELECT x ->> 'id' FROM jsonb_array_elements(j -> 'rows') x);
  END LOOP;
  results := results || (CASE WHEN array_length(seen, 1) = 6 AND (SELECT count(DISTINCT s) FROM unnest(seen) s) = 6 THEN 'PASS' ELSE 'FAIL' END
    || ' cursor pages of 2 return all 6 files once (' || coalesce(array_length(seen, 1), 0) || ')');

  j := public.media_list(ws_a, 'image', NULL, NULL, NULL, 50);
  results := results || (CASE WHEN jsonb_array_length(j -> 'rows') = 5 AND j -> 'next' = 'null'::jsonb THEN 'PASS' ELSE 'FAIL' END || ' kind filter: 5 images, no next page');
  j := public.media_list(ws_a, 'document', NULL, NULL, NULL, 50);
  results := results || (CASE WHEN jsonb_array_length(j -> 'rows') = 1 THEN 'PASS' ELSE 'FAIL' END || ' kind filter: 1 document');
  j := public.media_list(ws_a, NULL, 'front of', NULL, NULL, 50);
  results := results || (CASE WHEN jsonb_array_length(j -> 'rows') = 1 AND j -> 'rows' -> 0 ->> 'thumb_path' = pa_thumb THEN 'PASS' ELSE 'FAIL' END || ' search matches alt text, returns the thumbnail path');
  j := public.media_list(ws_a, NULL, '%', NULL, NULL, 50);
  results := results || (CASE WHEN jsonb_array_length(j -> 'rows') = 1 THEN 'PASS' ELSE 'FAIL' END || ' search wildcards are literal (' || jsonb_array_length(j -> 'rows') || ')');
  BEGIN PERFORM public.media_list(ws_a, 'script', NULL, NULL, NULL, 50); results := results || 'FAIL unknown kind accepted'::text;
  EXCEPTION WHEN invalid_parameter_value THEN results := results || 'PASS unknown kind refused'::text; END;

  j := public.media_library_stats(ws_a);
  results := results || (CASE WHEN (j ->> 'files')::int = 6 AND (j ->> 'bytes')::bigint = 2100 AND (j ->> 'images')::int = 5 AND (j ->> 'documents')::int = 1
    THEN 'PASS' ELSE 'FAIL' END || ' website stats ' || j::text);

  SELECT * INTO r FROM public.org_storage_usage(org_a);
  -- media: pa 1000 + thumb 100 + mismatched 10 + 5 x 200 + legacy 50 = 2160; brand logo 20; contracts not counted
  results := results || (CASE WHEN r.bytes = 2180 AND r.files = 9 AND r.media_bytes = 2160 AND r.media_files = 8 AND r.thumbnail_bytes = 100 AND r.brand_bytes = 20
    THEN 'PASS' ELSE 'FAIL' END || ' org_storage_usage from stored objects (' || r.bytes || ' bytes, ' || r.files || ' files)');

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'contracts';
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' member reads own private contract files');
  EXECUTE 'RESET ROLE';

  -- ---------- owner of org B ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'media';
  results := results || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' org B lists only its own media objects (' || n || ')');
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id IN ('contracts', 'brand');
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' org B cannot list org A contracts or logos');
  SELECT count(*) INTO n FROM public.media;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' org B sees no org A media rows');
  BEGIN PERFORM public.media_list(ws_a, NULL, NULL, NULL, NULL, 10); results := results || 'FAIL org B listed org A media'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS org B cannot call media_list on org A'::text; END;
  BEGIN PERFORM public.media_library_stats(ws_a); results := results || 'FAIL org B read org A stats'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS org B cannot read org A stats'::text; END;
  BEGIN PERFORM * FROM public.org_storage_usage(org_a); results := results || 'FAIL org B read org A usage'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS org B cannot read org A usage'::text; END;
  SELECT * INTO r FROM public.org_storage_usage(org_b);
  results := results || (CASE WHEN r.bytes = 4000 AND r.files = 1 THEN 'PASS' ELSE 'FAIL' END || ' org B usage counts only its own files');
  EXECUTE 'RESET ROLE';

  -- ---------- outsider and anonymous ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM storage.objects;
  results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' outsider lists no objects');
  BEGIN INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('media', base_a || gen_random_uuid() || '.png', u_x);
    results := results || 'FAIL outsider uploaded'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS outsider cannot upload'::text; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO n FROM storage.objects;
    results := results || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' anonymous lists no objects');
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS anonymous lists no objects (no privilege)'::text; END;
  BEGIN PERFORM * FROM public.org_storage_usage(org_a); results := results || 'FAIL anon read usage'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS anon cannot call org_storage_usage'::text; END;
  BEGIN PERFORM public.media_list(ws_a, NULL, NULL, NULL, NULL, 10); results := results || 'FAIL anon listed media'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS anon cannot call media_list'::text; END;
  EXECUTE 'RESET ROLE';

  -- ---------- contract gate on the new layout ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  c1 := public.admin_create_contract(org_a, 'msa', ws_a, 'en', '{"projectName":"Site A"}'::jsonb, true);
  PERFORM public.admin_send_contract(c1);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('media', base_a || gen_random_uuid() || '.png', u_e);
    results := results || 'FAIL upload while the contract is unsigned'::text;
  EXCEPTION WHEN insufficient_privilege THEN results := results || 'PASS upload refused while the contract is unsigned'::text; END;
  EXECUTE 'RESET ROLE';

  results := results || (CASE WHEN NOT has_function_privilege('anon', 'private.org_storage_usage(uuid)', 'execute')
    AND NOT has_function_privilege('authenticated', 'private.org_storage_usage(uuid)', 'execute') THEN 'PASS' ELSE 'FAIL' END || ' internal usage function not callable by API roles');

  SELECT count(*) INTO failed FROM unnest(results) x WHERE x LIKE 'FAIL%';
  RAISE EXCEPTION E'TEST REPORT (rolled back): % failed / % total\n%',
    failed, array_length(results, 1), array_to_string(results, E'\n');
END;
$$;
