-- SEO settings length limits (migration 20261031110000). Always rolls back;
-- the exception message is the report and must show "0 failed".
DO $$
DECLARE
  org uuid; ws text; r text[] := '{}';
BEGIN
  INSERT INTO public.organizations (name, slug) VALUES ('Limits', 'limits-test') RETURNING id INTO org;
  INSERT INTO public.websites (organization_id, name, status) VALUES (org, 'Limits site', 'active') RETURNING id INTO ws;

  INSERT INTO public.website_settings (website_id, organization_id, key, value)
  VALUES (ws, org, 'seo', jsonb_build_object('title', repeat('t', 70), 'description', repeat('d', 320),
    'keywords', to_jsonb(array_fill('k'::text, ARRAY[20]))));
  r := r || 'PASS title 70 / description 320 / 20 keywords accepted'::text;

  BEGIN UPDATE public.website_settings SET value = value || jsonb_build_object('title', repeat('t', 71)) WHERE website_id = ws AND key = 'seo';
    r := r || 'FAIL 71-character title accepted'::text;
  EXCEPTION WHEN check_violation THEN r := r || 'PASS 71-character title refused'::text; END;
  BEGIN UPDATE public.website_settings SET value = value || jsonb_build_object('description', repeat('d', 321)) WHERE website_id = ws AND key = 'seo';
    r := r || 'FAIL 321-character description accepted'::text;
  EXCEPTION WHEN check_violation THEN r := r || 'PASS 321-character description refused'::text; END;
  BEGIN UPDATE public.website_settings SET value = value || jsonb_build_object('business_name', repeat('b', 121)) WHERE website_id = ws AND key = 'seo';
    r := r || 'FAIL 121-character business name accepted'::text;
  EXCEPTION WHEN check_violation THEN r := r || 'PASS 121-character business name refused'::text; END;
  BEGIN UPDATE public.website_settings SET value = value || jsonb_build_object('keywords', to_jsonb(array_fill('k'::text, ARRAY[21]))) WHERE website_id = ws AND key = 'seo';
    r := r || 'FAIL 21 keywords accepted'::text;
  EXCEPTION WHEN check_violation THEN r := r || 'PASS 21 keywords refused'::text; END;

  INSERT INTO public.website_settings (website_id, organization_id, key, value)
  VALUES (ws, org, 'branding', jsonb_build_object('title', repeat('t', 500)));
  r := r || 'PASS other settings keys are not affected'::text;

  RAISE EXCEPTION E'TEXT LIMITS TESTS (rolled back): % failed\n%',
    (SELECT count(*) FROM unnest(r) x WHERE x LIKE 'FAIL%'), array_to_string(r, E'\n');
END $$;
