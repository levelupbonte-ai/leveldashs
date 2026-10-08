-- LevelUp Ecosystem API: everything a client website needs, in the database.
--
-- 1. Scale: indexes for per-website time ranges (rate limits, inboxes) and
--    the remaining unindexed foreign key.
-- 2. websites.allowed_origins: browser writes (forms, bookings, waitlist) are
--    only accepted from the client's own domains when the list is set.
-- 3. get_site_bundle(): all published content of a website in one call.
-- 4. Client onboarding for LevelUp staff: admin_create_client_site() and
--    admin_update_website().
-- 5. organization_invitations: invite by e-mail before the person has an
--    account; accepted automatically once their e-mail address is verified.

-- ============================================================================
-- 1. Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS website_settings_site_org_idx
  ON public.website_settings (website_id, organization_id);
CREATE INDEX IF NOT EXISTS form_submissions_site_created_idx
  ON public.form_submissions (website_id, created_at DESC);
CREATE INDEX IF NOT EXISTS form_submissions_site_status_idx
  ON public.form_submissions (website_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS appointments_site_created_idx
  ON public.appointments (website_id, created_at DESC);
CREATE INDEX IF NOT EXISTS appointments_site_status_date_idx
  ON public.appointments (website_id, status, appointment_date);
CREATE INDEX IF NOT EXISTS waitlist_site_joined_idx
  ON public.waitlist_entries (website_id, joined_at DESC);

-- ============================================================================
-- 2. Allowed origins
-- ============================================================================

ALTER TABLE public.websites
  ADD COLUMN IF NOT EXISTS allowed_origins text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(allowed_origins) <= 20);

COMMENT ON COLUMN public.websites.allowed_origins IS
  'Browser origins (https://example.com) allowed to call the public write RPCs. Empty = any origin.';

-- Seed the known client domains.
UPDATE public.websites SET allowed_origins = ARRAY[
  'https://levelup-ecosystem.com', 'https://www.levelup-ecosystem.com', 'https://app.levelup-ecosystem.com']
WHERE id = 'ws_6e797257f5b32b86' AND allowed_origins = '{}';
UPDATE public.websites SET allowed_origins = ARRAY['https://studio.levelup-ecosystem.com']
WHERE id = 'ws_871c0924a6afc646' AND allowed_origins = '{}';
UPDATE public.websites SET allowed_origins = ARRAY['https://finalstop.org', 'https://www.finalstop.org']
WHERE id = 'ws_d5e600b7dc2ec9a9' AND allowed_origins = '{}';
UPDATE public.websites SET allowed_origins = ARRAY['https://blackpater.com', 'https://www.blackpater.com']
WHERE id = 'ws_ab9493c5857ed460' AND allowed_origins = '{}';

-- Browsers always send Origin on cross-site POSTs and scripts cannot forge it,
-- so another website cannot use a client's forms. Server-side callers (no
-- Origin header) are still covered by the rate limits below.
CREATE OR REPLACE FUNCTION private.assert_origin_allowed(p_website_id text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_origin text;
  v_allowed text[];
BEGIN
  BEGIN
    v_origin := lower(nullif(current_setting('request.headers', true), '')::json ->> 'origin');
  EXCEPTION WHEN others THEN
    v_origin := NULL;
  END;
  IF v_origin IS NULL THEN
    RETURN;
  END IF;

  SELECT allowed_origins INTO v_allowed FROM public.websites WHERE id = p_website_id;
  IF v_allowed IS NULL OR cardinality(v_allowed) = 0 THEN
    RETURN;
  END IF;
  -- Local development of the site itself.
  IF v_origin ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$' THEN
    RETURN;
  END IF;
  IF NOT (v_origin = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'Origin not allowed for this website' USING ERRCODE = 'PT403';
  END IF;
END;
$$;

-- Same rate limits as before, plus the origin check; indexed time ranges.
CREATE OR REPLACE FUNCTION private.assert_public_write_allowed(
  p_website_id text,
  p_email text,
  p_phone text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_site_count integer;
  v_contact_count integer;
BEGIN
  PERFORM private.assert_origin_allowed(p_website_id);

  SELECT
    (SELECT count(*) FROM public.form_submissions WHERE website_id = p_website_id AND created_at > now() - interval '1 hour')
    + (SELECT count(*) FROM public.appointments WHERE website_id = p_website_id AND created_at > now() - interval '1 hour')
    + (SELECT count(*) FROM public.waitlist_entries WHERE website_id = p_website_id AND joined_at > now() - interval '1 hour')
  INTO v_site_count;

  IF v_site_count >= 300 THEN
    RAISE EXCEPTION 'Too many requests, please try again later' USING ERRCODE = 'PT429';
  END IF;

  IF p_email IS NOT NULL OR p_phone IS NOT NULL THEN
    SELECT
      (SELECT count(*) FROM public.form_submissions
        WHERE website_id = p_website_id AND created_at > now() - interval '1 hour'
          AND ((p_email IS NOT NULL AND lower(email) = lower(p_email)) OR (p_phone IS NOT NULL AND phone = p_phone)))
      + (SELECT count(*) FROM public.appointments
        WHERE website_id = p_website_id AND created_at > now() - interval '1 hour'
          AND ((p_email IS NOT NULL AND lower(customer_email) = lower(p_email)) OR (p_phone IS NOT NULL AND customer_phone = p_phone)))
      + (SELECT count(*) FROM public.waitlist_entries
        WHERE website_id = p_website_id AND joined_at > now() - interval '1 hour'
          AND ((p_email IS NOT NULL AND lower(customer_email) = lower(p_email)) OR (p_phone IS NOT NULL AND customer_phone = p_phone)))
    INTO v_contact_count;

    IF v_contact_count >= 5 THEN
      RAISE EXCEPTION 'Too many requests, please try again later' USING ERRCODE = 'PT429';
    END IF;
  END IF;
END;
$$;

-- ============================================================================
-- 3. Site bundle (public read API)
-- ============================================================================

-- One round trip for a whole site: public settings, page blocks and the
-- published content of every enabled feature. Only public columns; never
-- customer data. NULL when the website is not live.
CREATE OR REPLACE FUNCTION public.get_site_bundle(p_website_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_site jsonb;
  v_features text[];
BEGIN
  IF p_website_id IS NULL OR p_website_id !~ '^ws_[a-z0-9]{8,32}$' THEN
    RETURN NULL;
  END IF;

  v_site := public.get_public_website(p_website_id);
  IF v_site IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(f), '{}') INTO v_features
  FROM jsonb_array_elements_text(v_site -> 'features') AS f;

  RETURN v_site || jsonb_build_object(
    'generated_at', now(),
    'blocks', coalesce((
      SELECT jsonb_object_agg(page, blocks)
      FROM (
        SELECT b.page, jsonb_object_agg(b.block_key, b.data ORDER BY b.sort_order) AS blocks
        FROM public.content_blocks b
        WHERE b.website_id = p_website_id AND b.status = 'published'
        GROUP BY b.page
      ) p
    ), '{}'::jsonb),
    'services', CASE WHEN 'services' = ANY (v_features) THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', s.slug, 'name', s.name, 'category', s.category, 'description', s.description,
        'price_cents', s.price_cents, 'price_label', s.price_label, 'currency', s.currency,
        'duration_minutes', s.duration_minutes, 'duration_label', s.duration_label,
        'badge', s.badge, 'featured', s.featured, 'inclusions', to_jsonb(s.inclusions),
        'image_url', s.image_url, 'team_member', tm.slug, 'data', s.data
      ) ORDER BY s.sort_order, s.created_at)
      FROM (SELECT * FROM public.services
            WHERE website_id = p_website_id AND status = 'published'
            ORDER BY sort_order, created_at LIMIT 500) s
      LEFT JOIN public.team_members tm ON tm.id = s.team_member_id
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'team', CASE WHEN 'team' = ANY (v_features) THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', t.slug, 'name', t.name, 'role', t.role, 'bio', t.bio,
        'image_url', t.image_url, 'tags', to_jsonb(t.tags), 'data', t.data
      ) ORDER BY t.sort_order, t.created_at)
      FROM (SELECT * FROM public.team_members
            WHERE website_id = p_website_id AND status = 'published'
            ORDER BY sort_order, created_at LIMIT 200) t
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'gallery', CASE WHEN 'gallery' = ANY (v_features) THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'title', g.title, 'description', g.description, 'category', g.category,
        'audience', g.audience, 'image_url', g.image_url, 'tags', to_jsonb(g.tags),
        'team_member', tm.slug
      ) ORDER BY g.sort_order, g.created_at)
      FROM (SELECT * FROM public.gallery_items
            WHERE website_id = p_website_id AND status = 'published'
            ORDER BY sort_order, created_at LIMIT 500) g
      LEFT JOIN public.team_members tm ON tm.id = g.team_member_id
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'reviews', CASE WHEN 'reviews' = ANY (v_features) THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'author', r.author, 'rating', r.rating, 'comment', r.comment,
        'review_date', r.review_date, 'source', r.source, 'data', r.data
      ) ORDER BY r.sort_order, r.created_at)
      FROM (SELECT * FROM public.reviews
            WHERE website_id = p_website_id AND status = 'published'
            ORDER BY sort_order, created_at LIMIT 200) r
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'faq', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'category', q.category, 'question', q.question, 'answer', q.answer
      ) ORDER BY q.sort_order, q.created_at)
      FROM (SELECT * FROM public.faq_items
            WHERE website_id = p_website_id AND status = 'published'
            ORDER BY sort_order, created_at LIMIT 200) q
    ), '[]'::jsonb),
    'announcements', CASE WHEN v_features && ARRAY['announcements', 'promotions', 'blog'] THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', a.slug, 'title', a.title, 'content', a.content, 'image_url', a.image_url,
        'published_at', a.published_at, 'expires_at', a.expires_at
      ) ORDER BY a.published_at DESC NULLS LAST, a.created_at DESC)
      FROM (SELECT * FROM public.announcements
            WHERE website_id = p_website_id AND status = 'published'
              AND (published_at IS NULL OR published_at <= now())
              AND (expires_at IS NULL OR expires_at > now())
            ORDER BY published_at DESC NULLS LAST, created_at DESC LIMIT 100) a
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_site_bundle(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_site_bundle(text) TO anon, authenticated;

-- ============================================================================
-- 5. Invitations (before 4: onboarding uses them)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(btrim(email))),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  invited_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_pending_uniq
  ON public.organization_invitations (organization_id, email) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS organization_invitations_email_idx
  ON public.organization_invitations (email) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS organization_invitations_invited_by_idx
  ON public.organization_invitations (invited_by);
CREATE INDEX IF NOT EXISTS organization_invitations_accepted_by_idx
  ON public.organization_invitations (accepted_by);

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

-- Admins see their organization's invitations; writes go through RPCs only.
GRANT SELECT ON public.organization_invitations TO authenticated;
GRANT DELETE ON public.organization_invitations TO authenticated;

CREATE POLICY organization_invitations_select ON public.organization_invitations
  FOR SELECT TO authenticated
  USING (private.has_org_role(organization_id, 'admin'));

CREATE POLICY organization_invitations_delete ON public.organization_invitations
  FOR DELETE TO authenticated
  USING (
    accepted_at IS NULL
    AND private.has_org_role(organization_id, 'admin')
    AND (role <> 'owner' OR private.has_org_role(organization_id, 'owner') OR private.is_platform_admin())
  );

-- Accept pending invitations once the e-mail address is verified (sign-up
-- confirmation, Google sign-in, or e-mail change confirmation). Never on an
-- unverified address, so nobody can claim an invitation for someone else.
CREATE OR REPLACE FUNCTION private.accept_invitations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inv record;
BEGIN
  IF NEW.email_confirmed_at IS NULL OR NEW.email IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NOT NULL AND OLD.email IS NOT DISTINCT FROM NEW.email THEN
    RETURN NEW;
  END IF;

  FOR inv IN
    SELECT * FROM public.organization_invitations
    WHERE email = lower(NEW.email) AND accepted_at IS NULL AND expires_at > now()
    FOR UPDATE
  LOOP
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (inv.organization_id, NEW.id, inv.role)
    ON CONFLICT (organization_id, user_id) DO UPDATE
      SET role = CASE
        WHEN private.role_rank(EXCLUDED.role) > private.role_rank(public.organization_members.role)
        THEN EXCLUDED.role ELSE public.organization_members.role END;
    UPDATE public.organization_invitations
    SET accepted_at = now(), accepted_by = NEW.id
    WHERE id = inv.id;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_verified_accept_invitations
  AFTER INSERT OR UPDATE OF email_confirmed_at, email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.accept_invitations();

-- Shared by add_organization_member and admin_create_client_site.
CREATE OR REPLACE FUNCTION private.invite_member(p_organization_id uuid, p_email text, p_role text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_user uuid;
  v_existing text;
BEGIN
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR char_length(v_email) > 254 THEN
    RAISE EXCEPTION 'Invalid e-mail' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_user FROM auth.users
  WHERE lower(email) = v_email AND deleted_at IS NULL AND email_confirmed_at IS NOT NULL
  LIMIT 1;

  IF v_user IS NULL THEN
    INSERT INTO public.organization_invitations (organization_id, email, role, invited_by)
    VALUES (p_organization_id, v_email, p_role, auth.uid())
    ON CONFLICT (organization_id, email) WHERE accepted_at IS NULL
    DO UPDATE SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by,
                  expires_at = now() + interval '30 days';
    RETURN 'invited';
  END IF;

  SELECT role INTO v_existing FROM public.organization_members
  WHERE organization_id = p_organization_id AND user_id = v_user;

  IF v_existing IS NULL THEN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (p_organization_id, v_user, p_role);
    RETURN 'added';
  END IF;

  UPDATE public.organization_members SET role = p_role
  WHERE organization_id = p_organization_id AND user_id = v_user;
  RETURN 'updated';
END;
$$;

REVOKE EXECUTE ON FUNCTION private.invite_member(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.accept_invitations() FROM PUBLIC, anon, authenticated;

-- add_organization_member now invites people who have no (verified) account yet.
CREATE OR REPLACE FUNCTION public.add_organization_member(p_organization_id uuid, p_email text, p_role text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_role NOT IN ('owner', 'admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role' USING ERRCODE = '22023';
  END IF;
  IF NOT private.has_org_role(p_organization_id, CASE WHEN p_role = 'owner' THEN 'owner' ELSE 'admin' END) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = 'PT403';
  END IF;

  -- Changing an existing owner's role is reserved to owners.
  SELECT m.role INTO v_existing
  FROM public.organization_members m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.organization_id = p_organization_id AND lower(u.email) = lower(btrim(p_email));
  IF v_existing = 'owner' AND NOT private.has_org_role(p_organization_id, 'owner') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = 'PT403';
  END IF;

  RETURN private.invite_member(p_organization_id, p_email, p_role);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_organization_member(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_organization_member(uuid, text, text) TO authenticated;

-- ============================================================================
-- 4. Client onboarding (LevelUp staff only)
-- ============================================================================

CREATE OR REPLACE FUNCTION private.assert_platform_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = 'PT403';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.normalize_origins(p_origins text[])
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  o text;
  v_out text[] := '{}';
BEGIN
  FOREACH o IN ARRAY coalesce(p_origins, '{}') LOOP
    o := lower(regexp_replace(btrim(o), '/+$', ''));
    IF o = '' THEN CONTINUE; END IF;
    IF o !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$' THEN
      RAISE EXCEPTION 'Invalid origin: %', o USING ERRCODE = '22023';
    END IF;
    IF NOT o = ANY (v_out) THEN v_out := v_out || o; END IF;
  END LOOP;
  RETURN v_out;
END;
$$;

-- Creates the client organization (or uses p_organization_id), a website with its
-- features and allowed origins, and invites the owner by e-mail.
CREATE OR REPLACE FUNCTION public.admin_create_client_site(
  p_website_name text,
  p_organization_name text DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL,
  p_primary_domain text DEFAULT NULL,
  p_site_type text DEFAULT NULL,
  p_features text[] DEFAULT '{}',
  p_owner_email text DEFAULT NULL,
  p_allowed_origins text[] DEFAULT NULL,
  p_status text DEFAULT 'active'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_name text := private.clean_text(p_organization_name, 120);
  v_site_name text := private.clean_text(p_website_name, 120);
  v_domain text := nullif(lower(btrim(coalesce(p_primary_domain, ''))), '');
  v_slug text;
  v_org uuid;
  v_site text;
  v_origins text[];
  v_owner text;
  v_unknown text[];
BEGIN
  PERFORM private.assert_platform_admin();

  IF v_site_name IS NULL OR (v_org_name IS NULL AND p_organization_id IS NULL) THEN
    RAISE EXCEPTION 'Website name and organization (name or id) are required' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION 'Invalid status' USING ERRCODE = '22023';
  END IF;
  v_domain := regexp_replace(regexp_replace(v_domain, '^https?://', ''), '/.*$', '');

  SELECT array_agg(f) INTO v_unknown
  FROM unnest(coalesce(p_features, '{}')) f
  WHERE NOT EXISTS (SELECT 1 FROM public.features WHERE key = f AND is_active);
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown features: %', array_to_string(v_unknown, ', ') USING ERRCODE = '22023';
  END IF;

  IF p_organization_id IS NOT NULL THEN
    -- Another website for an existing client.
    SELECT id INTO v_org FROM public.organizations WHERE id = p_organization_id AND status <> 'archived';
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'PT404';
    END IF;
  ELSE
    v_slug := trim(both '-' from left(trim(both '-' from regexp_replace(lower(
      translate(v_org_name, 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')),
      '[^a-z0-9]+', '-', 'g')), 40));
    IF v_slug = '' THEN v_slug := 'client'; END IF;
    IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) THEN
      v_slug := v_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
    END IF;
    INSERT INTO public.organizations (slug, name, created_by)
    VALUES (v_slug, v_org_name, auth.uid())
    RETURNING id INTO v_org;
  END IF;

  v_origins := private.normalize_origins(coalesce(
    p_allowed_origins,
    CASE WHEN v_domain IS NULL THEN '{}'::text[]
         ELSE ARRAY['https://' || regexp_replace(v_domain, '^www\.', ''),
                    'https://www.' || regexp_replace(v_domain, '^www\.', '')] END
  ));

  INSERT INTO public.websites (organization_id, name, primary_domain, site_type, status, allowed_origins)
  VALUES (v_org, v_site_name, v_domain, nullif(btrim(coalesce(p_site_type, '')), ''), p_status, v_origins)
  RETURNING id INTO v_site;

  INSERT INTO public.website_features (website_id, organization_id, feature_key)
  SELECT v_site, v_org, f FROM unnest(coalesce(p_features, '{}')) f
  ON CONFLICT DO NOTHING;

  IF p_owner_email IS NOT NULL AND btrim(p_owner_email) <> '' THEN
    v_owner := private.invite_member(v_org, p_owner_email, 'owner');
  END IF;

  RETURN jsonb_build_object(
    'organization_id', v_org,
    'website_id', v_site,
    'allowed_origins', to_jsonb(v_origins),
    'owner', v_owner
  );
END;
$$;

-- Changes LevelUp-controlled website fields. NULL arguments leave a field as is.
CREATE OR REPLACE FUNCTION public.admin_update_website(
  p_website_id text,
  p_status text DEFAULT NULL,
  p_primary_domain text DEFAULT NULL,
  p_features text[] DEFAULT NULL,
  p_allowed_origins text[] DEFAULT NULL,
  p_show_powered_by boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_unknown text[];
BEGIN
  PERFORM private.assert_platform_admin();

  SELECT organization_id INTO v_org FROM public.websites WHERE id = p_website_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Website not found' USING ERRCODE = 'PT404';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('draft', 'active', 'suspended', 'archived') THEN
    RAISE EXCEPTION 'Invalid status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.websites SET
    status = coalesce(p_status, status),
    primary_domain = CASE WHEN p_primary_domain IS NULL THEN primary_domain
                          ELSE nullif(regexp_replace(regexp_replace(lower(btrim(p_primary_domain)), '^https?://', ''), '/.*$', ''), '') END,
    allowed_origins = CASE WHEN p_allowed_origins IS NULL THEN allowed_origins
                           ELSE private.normalize_origins(p_allowed_origins) END,
    show_powered_by = coalesce(p_show_powered_by, show_powered_by)
  WHERE id = p_website_id;

  IF p_features IS NOT NULL THEN
    SELECT array_agg(f) INTO v_unknown
    FROM unnest(p_features) f
    WHERE NOT EXISTS (SELECT 1 FROM public.features WHERE key = f AND is_active);
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION 'Unknown features: %', array_to_string(v_unknown, ', ') USING ERRCODE = '22023';
    END IF;
    UPDATE public.website_features SET enabled = (feature_key = ANY (p_features))
    WHERE website_id = p_website_id;
    INSERT INTO public.website_features (website_id, organization_id, feature_key)
    SELECT p_website_id, v_org, f FROM unnest(p_features) f
    ON CONFLICT (website_id, feature_key) DO UPDATE SET enabled = true;
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'id', w.id, 'status', w.status, 'primary_domain', w.primary_domain,
      'allowed_origins', to_jsonb(w.allowed_origins), 'show_powered_by', w.show_powered_by,
      'features', coalesce((SELECT jsonb_agg(feature_key ORDER BY feature_key)
                            FROM public.website_features
                            WHERE website_id = w.id AND enabled), '[]'::jsonb))
    FROM public.websites w WHERE w.id = p_website_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION
  private.assert_platform_admin(),
  private.normalize_origins(text[])
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.assert_platform_admin(), private.normalize_origins(text[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION private.assert_origin_allowed(text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION
  public.admin_create_client_site(text, text, uuid, text, text, text[], text, text[], text),
  public.admin_update_website(text, text, text, text[], text[], boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.admin_create_client_site(text, text, uuid, text, text, text[], text, text[], text),
  public.admin_update_website(text, text, text, text[], text[], boolean)
  TO authenticated;
