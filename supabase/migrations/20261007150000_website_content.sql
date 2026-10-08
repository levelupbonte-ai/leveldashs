-- Website content, customer interactions and LevelStudio storage.
--
-- Everything a LevelUp website shows or collects lives here, scoped by
-- organization_id + website_id, so the client dashboard (and later the LevelUp
-- admin space) can manage every site without code deployments.
--
-- Access model
--   * Public (anon): read PUBLISHED content of LIVE websites only.
--   * Public writes never touch tables directly: they go through SECURITY
--     DEFINER RPCs that validate input, check the website feature is enabled,
--     compute prices/names server-side and rate-limit.
--   * Organization members: viewer reads, editor writes content and handles
--     bookings/requests, admin deletes customer records.
--   * LevelStudio tables are written only by the LevelStudio server (service role).
--
-- Additive except: studio_projects gains columns and `prompt` becomes nullable
-- (table is empty and unused by any code at the time of writing).

-- ============================================================================
-- Website-level flags controlled by LevelUp
-- ============================================================================

ALTER TABLE public.websites
  ADD COLUMN show_powered_by boolean NOT NULL DEFAULT true;

INSERT INTO public.features (key, name, description, sort_order) VALUES
  ('waitlist', 'Walk-in waitlist', 'Live walk-in queue with tickets', 55),
  ('quotes', 'Quote requests', 'Group / event quote requests', 65)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- Helpers
-- ============================================================================

GRANT USAGE ON SCHEMA private TO anon;

-- A website is publicly visible only while it and its organization are active.
CREATE OR REPLACE FUNCTION private.is_website_live(p_website_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.websites w
    JOIN public.organizations o ON o.id = w.organization_id
    WHERE w.id = p_website_id AND w.status = 'active' AND o.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION private.website_has_feature(p_website_id text, p_feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.website_features wf
    JOIN public.features f ON f.key = wf.feature_key
    WHERE wf.website_id = p_website_id
      AND wf.feature_key = p_feature
      AND wf.enabled
      AND f.is_active
  );
$$;

-- Human-friendly, non-sequential ticket codes (e.g. FS-7KQ2M9XA). 40 bits.
CREATE OR REPLACE FUNCTION private.generate_ticket_code(prefix text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(8);
  code text := '';
BEGIN
  FOR i IN 0..7 LOOP
    code := code || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  END LOOP;
  RETURN upper(prefix) || '-' || code;
END;
$$;

CREATE OR REPLACE FUNCTION private.is_valid_email(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_email IS NOT NULL
    AND char_length(p_email) BETWEEN 5 AND 254
    AND p_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$';
$$;

-- ============================================================================
-- Content tables
-- ============================================================================

-- Key/value settings per website (contact info, hours, social links, toggles).
CREATE TABLE public.website_settings (
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_.]{1,63}$'),
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (website_id, key),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE
);

-- Free-form page sections (hero, about, CTA, ...). `data` holds the copy.
CREATE TABLE public.content_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  page text NOT NULL DEFAULT 'home' CHECK (page ~ '^[a-z0-9][a-z0-9_/-]{0,63}$'),
  block_key text NOT NULL CHECK (block_key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id, page, block_key),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  role text,
  bio text,
  phone text,
  email text,
  image_url text,
  media_id uuid REFERENCES public.media (id) ON DELETE SET NULL,
  tags text[] NOT NULL DEFAULT '{}',
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id, slug),
  UNIQUE (id, website_id),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  category text,
  description text,
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  price_label text,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  duration_label text,
  badge text,
  featured boolean NOT NULL DEFAULT false,
  inclusions text[] NOT NULL DEFAULT '{}',
  image_url text,
  media_id uuid REFERENCES public.media (id) ON DELETE SET NULL,
  team_member_id uuid,
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id, slug),
  UNIQUE (id, website_id),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (team_member_id, website_id)
    REFERENCES public.team_members (id, website_id) ON DELETE SET NULL (team_member_id)
);

CREATE TABLE public.gallery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text,
  category text,
  audience text,
  image_url text NOT NULL,
  media_id uuid REFERENCES public.media (id) ON DELETE SET NULL,
  team_member_id uuid,
  tags text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (team_member_id, website_id)
    REFERENCES public.team_members (id, website_id) ON DELETE SET NULL (team_member_id)
);

CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  author text NOT NULL CHECK (char_length(author) BETWEEN 1 AND 120),
  rating smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  comment text NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 4000),
  review_date date,
  source text,
  team_member_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (team_member_id, website_id)
    REFERENCES public.team_members (id, website_id) ON DELETE SET NULL (team_member_id)
);

CREATE TABLE public.faq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  category text,
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
  answer text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 8000),
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  content text,
  image_url text,
  media_id uuid REFERENCES public.media (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id, slug),
  CHECK (expires_at IS NULL OR published_at IS NULL OR expires_at > published_at),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE
);

-- ============================================================================
-- Customer interactions
-- ============================================================================

CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  ticket_code text NOT NULL,
  customer_name text NOT NULL CHECK (char_length(customer_name) BETWEEN 1 AND 120),
  customer_email text CHECK (customer_email IS NULL OR char_length(customer_email) <= 254),
  customer_phone text CHECK (customer_phone IS NULL OR char_length(customer_phone) <= 40),
  service_id uuid,
  service_name text,
  price_label text,
  team_member_id uuid,
  team_member_name text,
  appointment_date date NOT NULL,
  appointment_time time NOT NULL,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  staff_notes text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  source text NOT NULL DEFAULT 'website',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id, ticket_code),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (service_id, website_id)
    REFERENCES public.services (id, website_id) ON DELETE SET NULL (service_id),
  FOREIGN KEY (team_member_id, website_id)
    REFERENCES public.team_members (id, website_id) ON DELETE SET NULL (team_member_id)
);

-- One active booking per team member per slot.
CREATE UNIQUE INDEX appointments_slot_uniq
  ON public.appointments (website_id, team_member_id, appointment_date, appointment_time)
  WHERE status IN ('pending', 'confirmed') AND team_member_id IS NOT NULL;

CREATE TABLE public.waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  ticket_code text NOT NULL,
  customer_name text NOT NULL CHECK (char_length(customer_name) BETWEEN 1 AND 120),
  customer_phone text CHECK (customer_phone IS NULL OR char_length(customer_phone) <= 40),
  customer_email text CHECK (customer_email IS NULL OR char_length(customer_email) <= 254),
  service_name text,
  team_member_id uuid,
  team_member_name text,
  position integer NOT NULL CHECK (position > 0),
  est_minutes integer NOT NULL DEFAULT 0 CHECK (est_minutes >= 0),
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'called', 'in_chair', 'served', 'cancelled')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id, ticket_code),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (team_member_id, website_id)
    REFERENCES public.team_members (id, website_id) ON DELETE SET NULL (team_member_id)
);

-- Contact forms, quote requests, VIP / newsletter sign-ups, registrations...
CREATE TABLE public.form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  form_type text NOT NULL
    CHECK (form_type IN ('contact', 'quote', 'vip_signup', 'newsletter', 'registration', 'preview_request')),
  ticket_code text NOT NULL,
  name text CHECK (name IS NULL OR char_length(name) <= 120),
  email text CHECK (email IS NULL OR char_length(email) <= 254),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 40),
  company text CHECK (company IS NULL OR char_length(company) <= 160),
  message text CHECK (message IS NULL OR char_length(message) <= 5000),
  data jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(data) = 'object' AND pg_column_size(data) <= 8192),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'in_progress', 'quoted', 'won', 'lost', 'closed', 'spam')),
  staff_notes text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id, ticket_code),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE
);

-- ============================================================================
-- LevelStudio
-- ============================================================================

-- Gallery templates (starters/styles seeded by LevelStudio, user imports).
CREATE TABLE public.studio_templates (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  tagline text,
  best_for text,
  service text NOT NULL DEFAULT 'landing' CHECK (service ~ '^[a-z][a-z0-9_-]{0,39}$'),
  accent text,
  kind text NOT NULL CHECK (kind IN ('starter', 'style', 'import')),
  palette text[] NOT NULL DEFAULT '{}',
  fonts text,
  sections text[] NOT NULL DEFAULT '{}',
  brief_prompt text,
  owner_user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  owner_anon_id text CHECK (owner_anon_id IS NULL OR owner_anon_id ~ '^anon_[a-f0-9]{16}$'),
  html text CHECK (html IS NULL OR octet_length(html) <= 819200),
  is_published boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'import' OR owner_user_id IS NOT NULL OR owner_anon_id IS NOT NULL)
);

CREATE INDEX studio_templates_service_idx ON public.studio_templates (service, sort_order);
CREATE INDEX studio_templates_owner_user_idx ON public.studio_templates (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX studio_templates_owner_anon_idx ON public.studio_templates (owner_anon_id) WHERE owner_anon_id IS NOT NULL;

-- Existing (empty, unused) table evolves to hold LevelStudio projects.
ALTER TABLE public.studio_projects
  ALTER COLUMN prompt DROP NOT NULL,
  ADD COLUMN organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  ADD COLUMN website_id text REFERENCES public.websites (id) ON DELETE SET NULL,
  ADD COLUMN owner_anon_id text CHECK (owner_anon_id IS NULL OR owner_anon_id ~ '^anon_[a-f0-9]{16}$'),
  ADD COLUMN style text,
  ADD COLUMN html text CHECK (html IS NULL OR octet_length(html) <= 2097152),
  ADD COLUMN template_id text REFERENCES public.studio_templates (id) ON DELETE SET NULL,
  ADD COLUMN messages jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(messages) = 'array'),
  ADD COLUMN generating boolean NOT NULL DEFAULT false,
  ADD COLUMN progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN share_token text UNIQUE,
  ADD COLUMN share_expires_at timestamptz;

ALTER TABLE public.studio_projects
  ADD CONSTRAINT studio_projects_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

CREATE TABLE public.studio_usage (
  day date NOT NULL,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 128),
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (day, subject)
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX website_settings_org_idx ON public.website_settings (organization_id);
CREATE INDEX content_blocks_site_idx ON public.content_blocks (website_id, organization_id, page, sort_order);
CREATE INDEX team_members_site_idx ON public.team_members (website_id, organization_id, sort_order);
CREATE INDEX services_site_idx ON public.services (website_id, organization_id, sort_order);
CREATE INDEX services_team_member_idx ON public.services (team_member_id, website_id);
CREATE INDEX gallery_items_site_idx ON public.gallery_items (website_id, organization_id, sort_order);
CREATE INDEX gallery_items_team_member_idx ON public.gallery_items (team_member_id, website_id);
CREATE INDEX reviews_site_idx ON public.reviews (website_id, organization_id, sort_order);
CREATE INDEX reviews_team_member_idx ON public.reviews (team_member_id, website_id);
CREATE INDEX faq_items_site_idx ON public.faq_items (website_id, organization_id, sort_order);
CREATE INDEX announcements_site_idx ON public.announcements (website_id, organization_id, published_at DESC);
CREATE INDEX appointments_site_date_idx ON public.appointments (website_id, organization_id, appointment_date, appointment_time);
CREATE INDEX appointments_service_idx ON public.appointments (service_id, website_id);
CREATE INDEX appointments_team_member_idx ON public.appointments (team_member_id, website_id);
CREATE INDEX appointments_email_idx ON public.appointments (website_id, lower(customer_email), created_at DESC);
CREATE INDEX waitlist_site_status_idx ON public.waitlist_entries (website_id, organization_id, status, position);
CREATE INDEX waitlist_team_member_idx ON public.waitlist_entries (team_member_id, website_id);
CREATE INDEX form_submissions_site_idx ON public.form_submissions (website_id, organization_id, created_at DESC);
CREATE INDEX form_submissions_email_idx ON public.form_submissions (website_id, lower(email), created_at DESC);
CREATE INDEX team_members_media_idx ON public.team_members (media_id);
CREATE INDEX services_media_idx ON public.services (media_id);
CREATE INDEX gallery_items_media_idx ON public.gallery_items (media_id);
CREATE INDEX announcements_media_idx ON public.announcements (media_id);
CREATE INDEX studio_projects_org_idx ON public.studio_projects (organization_id);
CREATE INDEX studio_projects_website_idx ON public.studio_projects (website_id);
CREATE INDEX studio_projects_template_idx ON public.studio_projects (template_id);
CREATE INDEX studio_projects_anon_idx ON public.studio_projects (owner_anon_id) WHERE owner_anon_id IS NOT NULL;
CREATE INDEX studio_assets_project_idx ON public.studio_assets (project_id);
-- FK indexes flagged by the performance advisor after tenant_foundation.
CREATE INDEX media_created_by_idx ON public.media (created_by);
CREATE INDEX media_site_org_idx ON public.media (website_id, organization_id);
CREATE INDEX organizations_created_by_idx ON public.organizations (created_by);
CREATE INDEX website_features_feature_idx ON public.website_features (feature_key);
CREATE INDEX website_features_site_org_idx ON public.website_features (website_id, organization_id);

-- ============================================================================
-- updated_at triggers
-- ============================================================================

CREATE TRIGGER website_settings_set_updated_at BEFORE UPDATE ON public.website_settings FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER content_blocks_set_updated_at BEFORE UPDATE ON public.content_blocks FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER team_members_set_updated_at BEFORE UPDATE ON public.team_members FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER services_set_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER gallery_items_set_updated_at BEFORE UPDATE ON public.gallery_items FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER faq_items_set_updated_at BEFORE UPDATE ON public.faq_items FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER announcements_set_updated_at BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER waitlist_entries_set_updated_at BEFORE UPDATE ON public.waitlist_entries FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER form_submissions_set_updated_at BEFORE UPDATE ON public.form_submissions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER studio_templates_set_updated_at BEFORE UPDATE ON public.studio_templates FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ============================================================================
-- Privileges
-- ============================================================================

REVOKE ALL ON public.website_settings, public.content_blocks, public.team_members,
  public.services, public.gallery_items, public.reviews, public.faq_items,
  public.announcements, public.appointments, public.waitlist_entries,
  public.form_submissions, public.studio_templates, public.studio_usage
  FROM anon, authenticated;

-- Published content: public read, editors write.
GRANT SELECT ON public.website_settings, public.content_blocks, public.team_members,
  public.services, public.gallery_items, public.reviews, public.faq_items,
  public.announcements
  TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.website_settings, public.content_blocks,
  public.team_members, public.services, public.gallery_items, public.reviews,
  public.faq_items, public.announcements
  TO authenticated;

-- Customer records: members only. Customers' own submitted fields stay immutable.
GRANT SELECT, DELETE ON public.appointments, public.waitlist_entries, public.form_submissions TO authenticated;
GRANT INSERT ON public.appointments, public.waitlist_entries TO authenticated;
GRANT UPDATE (status, staff_notes, appointment_date, appointment_time, team_member_id, team_member_name)
  ON public.appointments TO authenticated;
GRANT UPDATE (status, position, est_minutes, team_member_id, team_member_name)
  ON public.waitlist_entries TO authenticated;
GRANT UPDATE (status, staff_notes) ON public.form_submissions TO authenticated;

-- LevelStudio: published templates are public; writes are server-only.
GRANT SELECT ON public.studio_templates TO anon, authenticated;
REVOKE ALL ON public.studio_projects, public.studio_assets FROM anon, authenticated;
GRANT SELECT ON public.studio_projects TO authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  private.is_platform_admin(),
  private.has_org_role(uuid, text),
  private.shares_org_with(uuid),
  private.role_rank(text),
  private.can_access_media_path(text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_website_live(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.generate_public_id(text) TO service_role;

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE public.website_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_usage ENABLE ROW LEVEL SECURITY;

-- Public reads of published content (website must be live).
CREATE POLICY website_settings_public_read ON public.website_settings
  FOR SELECT TO anon, authenticated
  USING (is_public AND private.is_website_live(website_id));
CREATE POLICY content_blocks_public_read ON public.content_blocks
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND private.is_website_live(website_id));
CREATE POLICY team_members_public_read ON public.team_members
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND private.is_website_live(website_id));
CREATE POLICY services_public_read ON public.services
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND private.is_website_live(website_id));
CREATE POLICY gallery_items_public_read ON public.gallery_items
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND private.is_website_live(website_id));
CREATE POLICY reviews_public_read ON public.reviews
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND private.is_website_live(website_id));
CREATE POLICY faq_items_public_read ON public.faq_items
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND private.is_website_live(website_id));
CREATE POLICY announcements_public_read ON public.announcements
  FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    AND (published_at IS NULL OR published_at <= now())
    AND (expires_at IS NULL OR expires_at > now())
    AND private.is_website_live(website_id)
  );

-- Members: read everything of their organization, editors write.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['website_settings', 'content_blocks', 'team_members', 'services',
                           'gallery_items', 'reviews', 'faq_items', 'announcements'] LOOP
    EXECUTE format(
      'CREATE POLICY %1$s_member_read ON public.%1$s FOR SELECT TO authenticated
         USING (private.has_org_role(organization_id) OR private.is_platform_admin())', t);
    EXECUTE format(
      'CREATE POLICY %1$s_editor_insert ON public.%1$s FOR INSERT TO authenticated
         WITH CHECK (private.has_org_role(organization_id, ''editor''))', t);
    EXECUTE format(
      'CREATE POLICY %1$s_editor_update ON public.%1$s FOR UPDATE TO authenticated
         USING (private.has_org_role(organization_id, ''editor''))
         WITH CHECK (private.has_org_role(organization_id, ''editor''))', t);
    EXECUTE format(
      'CREATE POLICY %1$s_editor_delete ON public.%1$s FOR DELETE TO authenticated
         USING (private.has_org_role(organization_id, ''editor''))', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['appointments', 'waitlist_entries', 'form_submissions'] LOOP
    EXECUTE format(
      'CREATE POLICY %1$s_member_read ON public.%1$s FOR SELECT TO authenticated
         USING (private.has_org_role(organization_id) OR private.is_platform_admin())', t);
    EXECUTE format(
      'CREATE POLICY %1$s_editor_update ON public.%1$s FOR UPDATE TO authenticated
         USING (private.has_org_role(organization_id, ''editor''))
         WITH CHECK (private.has_org_role(organization_id, ''editor''))', t);
    EXECUTE format(
      'CREATE POLICY %1$s_admin_delete ON public.%1$s FOR DELETE TO authenticated
         USING (private.has_org_role(organization_id, ''admin''))', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['appointments', 'waitlist_entries'] LOOP
    EXECUTE format(
      'CREATE POLICY %1$s_editor_insert ON public.%1$s FOR INSERT TO authenticated
         WITH CHECK (private.has_org_role(organization_id, ''editor''))', t);
  END LOOP;
END;
$$;

-- LevelStudio
CREATE POLICY studio_templates_public_read ON public.studio_templates
  FOR SELECT TO anon, authenticated
  USING (kind IN ('starter', 'style') AND is_published);
CREATE POLICY studio_templates_owner_read ON public.studio_templates
  FOR SELECT TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));
CREATE POLICY studio_projects_owner_read ON public.studio_projects
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (organization_id IS NOT NULL AND private.has_org_role(organization_id))
    OR private.is_platform_admin()
  );
-- studio_usage: no policies (service role only).

-- ============================================================================
-- Public RPCs (anon) — the only way visitors write data
-- ============================================================================

-- Rate limit helper: raises when a website receives too many public writes.
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

CREATE OR REPLACE FUNCTION private.clean_text(p_value text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT nullif(left(btrim(regexp_replace(coalesce(p_value, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), p_max), '');
$$;

CREATE OR REPLACE FUNCTION private.ticket_prefix(p_website_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    nullif(left(upper(regexp_replace(
      (SELECT value ->> 'prefix' FROM public.website_settings WHERE website_id = p_website_id AND key = 'tickets'),
      '[^A-Za-z0-9]', '', 'g')), 6), ''),
    'LU');
$$;

CREATE OR REPLACE FUNCTION public.submit_form(
  p_website_id text,
  p_form_type text,
  p_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_company text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb,
  p_source text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_feature text;
  v_email text := lower(private.clean_text(p_email, 254));
  v_phone text := private.clean_text(p_phone, 40);
  v_ticket text;
BEGIN
  IF NOT private.is_website_live(p_website_id) THEN
    RAISE EXCEPTION 'Website not found' USING ERRCODE = 'PT404';
  END IF;

  v_feature := CASE p_form_type
    WHEN 'contact' THEN 'contact_form'
    WHEN 'preview_request' THEN 'contact_form'
    WHEN 'registration' THEN 'contact_form'
    WHEN 'quote' THEN 'quotes'
    WHEN 'vip_signup' THEN 'newsletter'
    WHEN 'newsletter' THEN 'newsletter'
  END;
  IF v_feature IS NULL THEN
    RAISE EXCEPTION 'Unknown form type' USING ERRCODE = '22023';
  END IF;
  IF NOT private.website_has_feature(p_website_id, v_feature) THEN
    RAISE EXCEPTION 'This form is not available' USING ERRCODE = 'PT403';
  END IF;

  IF v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'An email or phone number is required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND NOT private.is_valid_email(v_email) THEN
    RAISE EXCEPTION 'Invalid email address' USING ERRCODE = '22023';
  END IF;
  IF p_data IS NOT NULL AND jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Invalid data' USING ERRCODE = '22023';
  END IF;

  PERFORM private.assert_public_write_allowed(p_website_id, v_email, v_phone);

  SELECT organization_id INTO v_org FROM public.websites WHERE id = p_website_id;
  v_ticket := private.generate_ticket_code(private.ticket_prefix(p_website_id));

  INSERT INTO public.form_submissions (
    website_id, organization_id, form_type, ticket_code, name, email, phone, company, message, data, source
  ) VALUES (
    p_website_id, v_org, p_form_type, v_ticket,
    private.clean_text(p_name, 120), v_email, v_phone,
    private.clean_text(p_company, 160), private.clean_text(p_message, 5000),
    coalesce(p_data, '{}'::jsonb), private.clean_text(p_source, 80)
  );

  RETURN jsonb_build_object('ticket_code', v_ticket);
END;
$$;

CREATE OR REPLACE FUNCTION public.book_appointment(
  p_website_id text,
  p_service_slug text,
  p_date date,
  p_time time,
  p_name text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_team_member_slug text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_service public.services;
  v_member public.team_members;
  v_email text := lower(private.clean_text(p_email, 254));
  v_phone text := private.clean_text(p_phone, 40);
  v_name text := private.clean_text(p_name, 120);
  v_ticket text;
BEGIN
  IF NOT private.is_website_live(p_website_id) THEN
    RAISE EXCEPTION 'Website not found' USING ERRCODE = 'PT404';
  END IF;
  IF NOT private.website_has_feature(p_website_id, 'bookings') THEN
    RAISE EXCEPTION 'Online booking is not available' USING ERRCODE = 'PT403';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Name is required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'An email or phone number is required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND NOT private.is_valid_email(v_email) THEN
    RAISE EXCEPTION 'Invalid email address' USING ERRCODE = '22023';
  END IF;
  IF p_date IS NULL OR p_time IS NULL
     OR p_date < (now() AT TIME ZONE 'UTC')::date - 1
     OR p_date > (now() AT TIME ZONE 'UTC')::date + 366 THEN
    RAISE EXCEPTION 'Invalid date' USING ERRCODE = '22023';
  END IF;

  -- Service, price and team member always come from the database.
  SELECT * INTO v_service FROM public.services
  WHERE website_id = p_website_id AND slug = p_service_slug AND status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown service' USING ERRCODE = '22023';
  END IF;

  IF p_team_member_slug IS NOT NULL AND p_team_member_slug <> '' THEN
    SELECT * INTO v_member FROM public.team_members
    WHERE website_id = p_website_id AND slug = p_team_member_slug AND status = 'published';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown team member' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM private.assert_public_write_allowed(p_website_id, v_email, v_phone);

  SELECT organization_id INTO v_org FROM public.websites WHERE id = p_website_id;
  v_ticket := private.generate_ticket_code(private.ticket_prefix(p_website_id));

  BEGIN
    INSERT INTO public.appointments (
      website_id, organization_id, ticket_code, customer_name, customer_email, customer_phone,
      service_id, service_name, price_label, team_member_id, team_member_name,
      appointment_date, appointment_time, notes, source
    ) VALUES (
      p_website_id, v_org, v_ticket, v_name, v_email, v_phone,
      v_service.id, v_service.name, v_service.price_label, v_member.id, v_member.name,
      p_date, p_time, private.clean_text(p_notes, 2000), 'website'
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This time slot is no longer available' USING ERRCODE = 'PT409';
  END;

  RETURN jsonb_build_object(
    'ticket_code', v_ticket,
    'service_name', v_service.name,
    'price_label', v_service.price_label,
    'team_member_name', v_member.name,
    'appointment_date', p_date,
    'appointment_time', p_time,
    'status', 'pending'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.join_waitlist(
  p_website_id text,
  p_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_service_slug text DEFAULT NULL,
  p_team_member_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_member public.team_members;
  v_service_name text;
  v_email text := lower(private.clean_text(p_email, 254));
  v_phone text := private.clean_text(p_phone, 40);
  v_name text := private.clean_text(p_name, 120);
  v_position integer;
  v_minutes_per_client integer;
  v_ticket text;
BEGIN
  IF NOT private.is_website_live(p_website_id) THEN
    RAISE EXCEPTION 'Website not found' USING ERRCODE = 'PT404';
  END IF;
  IF NOT private.website_has_feature(p_website_id, 'waitlist') THEN
    RAISE EXCEPTION 'The waitlist is not available' USING ERRCODE = 'PT403';
  END IF;
  IF coalesce((
    SELECT (value ->> 'open')::boolean FROM public.website_settings
    WHERE website_id = p_website_id AND key = 'waitlist'
  ), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'The waitlist is currently closed' USING ERRCODE = 'PT403';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Name is required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'An email or phone number is required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND NOT private.is_valid_email(v_email) THEN
    RAISE EXCEPTION 'Invalid email address' USING ERRCODE = '22023';
  END IF;

  IF p_team_member_slug IS NOT NULL AND p_team_member_slug <> '' THEN
    SELECT * INTO v_member FROM public.team_members
    WHERE website_id = p_website_id AND slug = p_team_member_slug AND status = 'published';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown team member' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_service_slug IS NOT NULL AND p_service_slug <> '' THEN
    SELECT name INTO v_service_name FROM public.services
    WHERE website_id = p_website_id AND slug = p_service_slug AND status = 'published';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown service' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM private.assert_public_write_allowed(p_website_id, v_email, v_phone);

  SELECT organization_id INTO v_org FROM public.websites WHERE id = p_website_id;

  -- Serialize position assignment per website.
  PERFORM pg_advisory_xact_lock(hashtext('waitlist:' || p_website_id));

  SELECT coalesce(max(position), 0) + 1 INTO v_position
  FROM public.waitlist_entries
  WHERE website_id = p_website_id AND status IN ('waiting', 'called', 'in_chair')
    AND joined_at > now() - interval '18 hours';

  v_minutes_per_client := coalesce((
    SELECT (value ->> 'minutes_per_client')::integer FROM public.website_settings
    WHERE website_id = p_website_id AND key = 'waitlist'
  ), 30);

  v_ticket := private.generate_ticket_code(private.ticket_prefix(p_website_id));

  INSERT INTO public.waitlist_entries (
    website_id, organization_id, ticket_code, customer_name, customer_phone, customer_email,
    service_name, team_member_id, team_member_name, position, est_minutes
  ) VALUES (
    p_website_id, v_org, v_ticket, v_name, v_phone, v_email,
    v_service_name, v_member.id, v_member.name, v_position, (v_position - 1) * v_minutes_per_client
  );

  RETURN jsonb_build_object(
    'ticket_code', v_ticket,
    'position', v_position,
    'est_minutes', (v_position - 1) * v_minutes_per_client,
    'status', 'waiting'
  );
END;
$$;

-- Public queue: no contact details, first name + initial only.
CREATE OR REPLACE FUNCTION public.get_public_waitlist(p_website_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'position', e.position,
      'display_name', split_part(e.customer_name, ' ', 1)
        || CASE WHEN split_part(e.customer_name, ' ', 2) <> ''
             THEN ' ' || left(split_part(e.customer_name, ' ', 2), 1) || '.' ELSE '' END,
      'team_member_name', e.team_member_name,
      'service_name', e.service_name,
      'status', e.status,
      'est_minutes', e.est_minutes
    ) ORDER BY e.position), '[]'::jsonb)
  FROM public.waitlist_entries e
  WHERE e.website_id = p_website_id
    AND private.is_website_live(p_website_id)
    AND private.website_has_feature(p_website_id, 'waitlist')
    AND e.status IN ('waiting', 'called', 'in_chair')
    AND e.joined_at > now() - interval '18 hours';
$$;

-- Ticket lookup: the ticket code is the secret; returns no contact details.
CREATE OR REPLACE FUNCTION public.get_ticket_status(p_website_id text, p_ticket_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text := upper(btrim(coalesce(p_ticket_code, '')));
  v_result jsonb;
BEGIN
  IF NOT private.is_website_live(p_website_id) OR v_code !~ '^[A-Z0-9]{1,8}-[A-Z0-9]{8}$' THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'type', 'appointment', 'ticket_code', a.ticket_code, 'status', a.status,
    'first_name', split_part(a.customer_name, ' ', 1),
    'service_name', a.service_name, 'team_member_name', a.team_member_name,
    'appointment_date', a.appointment_date, 'appointment_time', a.appointment_time)
  INTO v_result
  FROM public.appointments a
  WHERE a.website_id = p_website_id AND a.ticket_code = v_code;
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  SELECT jsonb_build_object(
    'type', 'waitlist', 'ticket_code', w.ticket_code, 'status', w.status,
    'first_name', split_part(w.customer_name, ' ', 1),
    'service_name', w.service_name, 'team_member_name', w.team_member_name,
    'position', w.position, 'est_minutes', w.est_minutes)
  INTO v_result
  FROM public.waitlist_entries w
  WHERE w.website_id = p_website_id AND w.ticket_code = v_code;
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  SELECT jsonb_build_object(
    'type', f.form_type, 'ticket_code', f.ticket_code, 'status', f.status,
    'first_name', split_part(coalesce(f.name, ''), ' ', 1))
  INTO v_result
  FROM public.form_submissions f
  WHERE f.website_id = p_website_id AND f.ticket_code = v_code;
  RETURN v_result;
END;
$$;

-- Public website configuration now also tells the site whether to show the
-- "Powered by LevelUp" badge (controlled by LevelUp, not by the client).
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
    'show_powered_by', w.show_powered_by,
    'features', coalesce((
      SELECT jsonb_agg(wf.feature_key ORDER BY f.sort_order)
      FROM public.website_features wf
      JOIN public.features f ON f.key = wf.feature_key
      WHERE wf.website_id = w.id AND wf.enabled AND f.is_active
    ), '[]'::jsonb),
    'settings', coalesce((
      SELECT jsonb_object_agg(s.key, s.value)
      FROM public.website_settings s
      WHERE s.website_id = w.id AND s.is_public
    ), '{}'::jsonb)
  )
  FROM public.websites w
  JOIN public.organizations o ON o.id = w.organization_id
  WHERE w.id = p_website_id
    AND w.status = 'active'
    AND o.status = 'active';
$$;

REVOKE EXECUTE ON FUNCTION
  public.submit_form(text, text, text, text, text, text, text, jsonb, text),
  public.book_appointment(text, text, date, time, text, text, text, text, text),
  public.join_waitlist(text, text, text, text, text, text),
  public.get_public_waitlist(text),
  public.get_ticket_status(text, text),
  public.get_public_website(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.submit_form(text, text, text, text, text, text, text, jsonb, text),
  public.book_appointment(text, text, date, time, text, text, text, text, text),
  public.join_waitlist(text, text, text, text, text, text),
  public.get_public_waitlist(text),
  public.get_ticket_status(text, text),
  public.get_public_website(text)
  TO anon, authenticated;
