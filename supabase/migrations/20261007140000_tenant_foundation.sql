-- Phase 1 — multi-tenant foundation for the LevelUp Ecosystem.
--
-- Adds: profiles, platform_admins, organizations, organization_members,
-- websites, features, website_features, media (+ "media" storage bucket).
-- Purely additive: no existing table, column or policy is modified.
--
-- Security model
--   * Every tenant-owned row carries organization_id (and website_id where it
--     belongs to a website). Child rows reference websites through a composite
--     FK (website_id, organization_id) so the two can never disagree.
--   * RLS decides access through private.* helpers (SECURITY DEFINER, not
--     exposed through the Data API). Policies target `authenticated` only.
--   * Table privileges are granted explicitly per column where updates are
--     allowed, so clients cannot change ownership, roles they don't manage,
--     website status/domain, or feature flags.
--   * Websites and feature flags are provisioned by LevelUp (service role /
--     LevelUp API), never directly by clients.

-- ============================================================================
-- Helpers
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Public, stable, non-sequential identifiers such as ws_3f9a1c0b7e2d4a61.
CREATE OR REPLACE FUNCTION private.generate_public_id(prefix text)
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT prefix || '_' || encode(extensions.gen_random_bytes(8), 'hex');
$$;

CREATE OR REPLACE FUNCTION private.role_rank(role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE role
    WHEN 'owner' THEN 4
    WHEN 'admin' THEN 3
    WHEN 'editor' THEN 2
    WHEN 'viewer' THEN 1
    ELSE 0
  END;
$$;

-- ============================================================================
-- Profiles & platform admins
-- ============================================================================

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text,
  full_name text CHECK (full_name IS NULL OR char_length(full_name) <= 120),
  avatar_url text CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- LevelUp staff. Kept out of profiles so users can never grant it to themselves.
CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    left(coalesce(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'), 120),
    left(coalesce(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture'), 2048)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

CREATE OR REPLACE FUNCTION private.handle_user_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION private.handle_user_email_change();

-- ============================================================================
-- Organizations & membership
-- ============================================================================

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'archived')),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TABLE public.organization_members (
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX organization_members_user_id_idx ON public.organization_members (user_id);

CREATE TRIGGER organization_members_set_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- An organization must always keep at least one owner. Cascading deletes from
-- the organization itself are allowed (the parent row is already gone).
CREATE OR REPLACE FUNCTION private.ensure_owner_remains()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.role = 'owner'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner')
     AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.organization_members m
       WHERE m.organization_id = OLD.organization_id
         AND m.role = 'owner'
         AND m.user_id <> OLD.user_id
     ) THEN
    RAISE EXCEPTION 'An organization must keep at least one owner'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER organization_members_ensure_owner
  BEFORE UPDATE OR DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION private.ensure_owner_remains();

-- ============================================================================
-- Authorization helpers (used by RLS)
-- ============================================================================

CREATE OR REPLACE FUNCTION private.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.has_org_role(org_id uuid, min_role text DEFAULT 'viewer')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = org_id
      AND m.user_id = (SELECT auth.uid())
      AND o.status <> 'archived'
      AND private.role_rank(m.role) >= private.role_rank(min_role)
  );
$$;

CREATE OR REPLACE FUNCTION private.shares_org_with(other_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members mine
    JOIN public.organization_members theirs
      ON theirs.organization_id = mine.organization_id
    WHERE mine.user_id = (SELECT auth.uid())
      AND theirs.user_id = other_user
  );
$$;

-- ============================================================================
-- Websites & features
-- ============================================================================

CREATE TABLE public.websites (
  id text PRIMARY KEY DEFAULT private.generate_public_id('ws')
    CHECK (id ~ '^ws_[a-z0-9]{8,32}$'),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  primary_domain text UNIQUE
    CHECK (primary_domain IS NULL OR primary_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  site_type text CHECK (site_type IS NULL OR site_type ~ '^[a-z][a-z0-9_]{1,47}$'),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'suspended', 'archived')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(settings) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Target for composite FKs that pin child rows to the website's tenant.
  UNIQUE (id, organization_id)
);

CREATE INDEX websites_organization_id_idx ON public.websites (organization_id);

CREATE TRIGGER websites_set_updated_at
  BEFORE UPDATE ON public.websites
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- Global catalog of features a website can enable.
CREATE TABLE public.features (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,47}$'),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.features (key, name, description, sort_order) VALUES
  ('announcements', 'Announcements', 'News and announcements with scheduling', 10),
  ('gallery', 'Gallery', 'Image gallery with categories and ordering', 20),
  ('services', 'Services', 'Service catalog with prices and durations', 30),
  ('products', 'Products', 'Product catalog', 40),
  ('bookings', 'Bookings', 'Online booking with availability', 50),
  ('contact_form', 'Contact form', 'Contact form submissions (leads)', 60),
  ('events', 'Events', 'Event pages and information', 70),
  ('blog', 'Blog', 'Articles with shareable URLs', 80),
  ('reviews', 'Reviews', 'Customer reviews and testimonials', 90),
  ('newsletter', 'Newsletter', 'Newsletter sign-ups', 100),
  ('team', 'Team', 'Team member profiles', 110),
  ('business_hours', 'Business hours', 'Opening hours and closures', 120),
  ('promotions', 'Promotions', 'Promotions and offers', 130),
  ('customer_accounts', 'Customer accounts', 'End-customer accounts on the website', 140),
  ('payments', 'Payments', 'Online payments', 150);

CREATE TABLE public.website_features (
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  feature_key text NOT NULL REFERENCES public.features (key) ON UPDATE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (website_id, feature_key),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX website_features_organization_id_idx ON public.website_features (organization_id);

CREATE TRIGGER website_features_set_updated_at
  BEFORE UPDATE ON public.website_features
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ============================================================================
-- Media (files live in Storage, rows reference them)
-- ============================================================================

CREATE TABLE public.media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  website_id text NOT NULL,
  bucket text NOT NULL DEFAULT 'media',
  storage_path text NOT NULL,
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (char_length(mime_type) <= 100),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 10485760),
  alt_text text CHECK (alt_text IS NULL OR char_length(alt_text) <= 500),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, storage_path),
  -- Files must live under <organization_id>/<website_id>/...
  CHECK (starts_with(storage_path, organization_id::text || '/' || website_id || '/')),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX media_organization_id_idx ON public.media (organization_id);
CREATE INDEX media_website_id_created_at_idx ON public.media (website_id, created_at DESC);

CREATE TRIGGER media_set_updated_at
  BEFORE UPDATE ON public.media
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ============================================================================
-- Privileges (explicit; RLS still applies on top)
-- ============================================================================

REVOKE ALL ON public.profiles, public.platform_admins, public.organizations,
  public.organization_members, public.websites, public.features,
  public.website_features, public.media
  FROM anon, authenticated;

GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url) ON public.profiles TO authenticated;

GRANT SELECT ON public.platform_admins TO authenticated;

GRANT SELECT ON public.organizations TO authenticated;
GRANT UPDATE (name) ON public.organizations TO authenticated;

GRANT SELECT, INSERT, DELETE ON public.organization_members TO authenticated;
GRANT UPDATE (role) ON public.organization_members TO authenticated;

GRANT SELECT ON public.websites TO authenticated;
GRANT UPDATE (name, settings) ON public.websites TO authenticated;

GRANT SELECT ON public.features TO anon, authenticated;

GRANT SELECT ON public.website_features TO authenticated;

GRANT SELECT, INSERT, DELETE ON public.media TO authenticated;
GRANT UPDATE (filename, alt_text) ON public.media TO authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  private.is_platform_admin(),
  private.has_org_role(uuid, text),
  private.shares_org_with(uuid),
  private.role_rank(text)
  TO authenticated;

-- The LevelUp backend (service role) provisions websites, whose id default
-- calls private.generate_public_id().
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.generate_public_id(text) TO service_role;

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.websites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR private.shares_org_with(id)
    OR private.is_platform_admin()
  );

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- platform_admins: a user can only see whether they are one.
CREATE POLICY platform_admins_select_own ON public.platform_admins
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- organizations (created through public.create_organization only)
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO authenticated
  USING (private.has_org_role(id) OR private.is_platform_admin());

CREATE POLICY organizations_update ON public.organizations
  FOR UPDATE TO authenticated
  USING (private.has_org_role(id, 'admin'))
  WITH CHECK (private.has_org_role(id, 'admin'));

-- organization_members
CREATE POLICY organization_members_select ON public.organization_members
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.has_org_role(organization_id)
    OR private.is_platform_admin()
  );

-- Admins manage non-owner members; only owners can grant or touch 'owner'.
CREATE POLICY organization_members_insert ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_org_role(organization_id, 'admin')
    AND (role <> 'owner' OR private.has_org_role(organization_id, 'owner'))
  );

CREATE POLICY organization_members_update ON public.organization_members
  FOR UPDATE TO authenticated
  USING (
    private.has_org_role(organization_id, 'admin')
    AND (role <> 'owner' OR private.has_org_role(organization_id, 'owner'))
  )
  WITH CHECK (
    private.has_org_role(organization_id, 'admin')
    AND (role <> 'owner' OR private.has_org_role(organization_id, 'owner'))
  );

-- Admins remove non-owner members; owners remove anyone; anyone can leave.
CREATE POLICY organization_members_delete ON public.organization_members
  FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (
      private.has_org_role(organization_id, 'admin')
      AND (role <> 'owner' OR private.has_org_role(organization_id, 'owner'))
    )
  );

-- websites (provisioned by LevelUp; org admins may rename / edit settings)
CREATE POLICY websites_select ON public.websites
  FOR SELECT TO authenticated
  USING (private.has_org_role(organization_id) OR private.is_platform_admin());

CREATE POLICY websites_update ON public.websites
  FOR UPDATE TO authenticated
  USING (private.has_org_role(organization_id, 'admin'))
  WITH CHECK (private.has_org_role(organization_id, 'admin'));

-- features catalog
CREATE POLICY features_select_active ON public.features
  FOR SELECT TO anon, authenticated
  USING (is_active);

-- website_features (read-only for clients)
CREATE POLICY website_features_select ON public.website_features
  FOR SELECT TO authenticated
  USING (private.has_org_role(organization_id) OR private.is_platform_admin());

-- media
CREATE POLICY media_select ON public.media
  FOR SELECT TO authenticated
  USING (private.has_org_role(organization_id) OR private.is_platform_admin());

CREATE POLICY media_insert ON public.media
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_org_role(organization_id, 'editor')
    AND created_by = (SELECT auth.uid())
    AND bucket = 'media'
  );

CREATE POLICY media_update ON public.media
  FOR UPDATE TO authenticated
  USING (private.has_org_role(organization_id, 'editor'))
  WITH CHECK (private.has_org_role(organization_id, 'editor'));

CREATE POLICY media_delete ON public.media
  FOR DELETE TO authenticated
  USING (private.has_org_role(organization_id, 'editor'));

-- ============================================================================
-- RPC: self-serve organization creation (atomic org + owner membership)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_organization(p_name text, p_slug text)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org public.organizations;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF (
    SELECT count(*) FROM public.organization_members
    WHERE user_id = v_uid AND role = 'owner'
  ) >= 5 THEN
    RAISE EXCEPTION 'Organization limit reached' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES (btrim(p_name), lower(btrim(p_slug)), v_uid)
  RETURNING * INTO v_org;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_org.id, v_uid, 'owner');

  RETURN v_org;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_organization(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated;

-- ============================================================================
-- RPC: public website configuration (what a client website needs to render)
-- Only active websites; exposes no tenant-private data.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_website(p_website_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', w.id,
    'name', w.name,
    'primary_domain', w.primary_domain,
    'site_type', w.site_type,
    'features', coalesce((
      SELECT jsonb_agg(wf.feature_key ORDER BY f.sort_order)
      FROM public.website_features wf
      JOIN public.features f ON f.key = wf.feature_key
      WHERE wf.website_id = w.id AND wf.enabled AND f.is_active
    ), '[]'::jsonb)
  )
  FROM public.websites w
  JOIN public.organizations o ON o.id = w.organization_id
  WHERE w.id = p_website_id
    AND w.status = 'active'
    AND o.status = 'active';
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_website(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_website(text) TO anon, authenticated;

-- ============================================================================
-- Storage: "media" bucket, paths <organization_id>/<website_id>/<file>
-- Public read (website images are public); writes restricted to org editors.
-- SVG is excluded on purpose (can carry scripts).
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.can_access_media_path(object_name text, min_role text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org text := split_part(object_name, '/', 1);
  v_site text := split_part(object_name, '/', 2);
BEGIN
  IF v_org !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR v_site !~ '^ws_[a-z0-9]{8,32}$'
     OR split_part(object_name, '/', 3) = '' THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.websites w
    WHERE w.id = v_site AND w.organization_id = v_org::uuid
  ) AND private.has_org_role(v_org::uuid, min_role);
END;
$$;

REVOKE EXECUTE ON FUNCTION private.can_access_media_path(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_access_media_path(text, text) TO authenticated;

CREATE POLICY media_objects_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND private.can_access_media_path(name, 'viewer'));

CREATE POLICY media_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND private.can_access_media_path(name, 'editor'));

CREATE POLICY media_objects_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND private.can_access_media_path(name, 'editor'))
  WITH CHECK (bucket_id = 'media' AND private.can_access_media_path(name, 'editor'));

CREATE POLICY media_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND private.can_access_media_path(name, 'editor'));
