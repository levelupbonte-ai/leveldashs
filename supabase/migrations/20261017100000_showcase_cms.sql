-- Showcase CMS: the LevelUp showcase site (levelup-ecosystem.com) driven from
-- the dashboard. Three tenant tables, like the other content collections
-- (organization_id + website_id, members read, editors write, Row Level
-- Security), exposed to the site through get_site_bundle (key "showcase") when
-- the website has the `showcase_cms` feature:
--
--   showcase_templates  demo-site templates (home band, /projects cards)
--   showcase_projects   client work and case studies (/projects, /projects/[slug])
--   showcase_sections   page sections: on/off, order, EN/FR text, animation
--
-- Seeded from the showcase's built-in data (src/components/home/templates-data.ts,
-- src/data/case-studies.ts, the projects list block, section copy), so the
-- site renders exactly as before after the switch. Edits ping the site's
-- /api/revalidate hook (private.ping_site_revalidate) and show within seconds.
-- See docs/showcase-cms.md.

-- ============================================================================
-- Feature
-- ============================================================================

INSERT INTO public.features (key, name, description, is_active, sort_order)
VALUES ('showcase_cms', 'Showcase CMS',
        'Templates, case studies and page sections of the LevelUp showcase site', true, 160)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- Tables
-- ============================================================================

CREATE TABLE public.showcase_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  url text NOT NULL CHECK (url ~ '^https://[^\s]+$' AND char_length(url) <= 2048),
  domain text CHECK (char_length(domain) <= 200),
  category_en text CHECK (char_length(category_en) <= 120),
  category_fr text CHECK (char_length(category_fr) <= 120),
  tagline_en text CHECK (char_length(tagline_en) <= 200),
  tagline_fr text CHECK (char_length(tagline_fr) <= 200),
  description_en text CHECK (char_length(description_en) <= 2000),
  description_fr text CHECK (char_length(description_fr) <= 2000),
  features_en text[] NOT NULL DEFAULT '{}' CHECK (cardinality(features_en) <= 12),
  features_fr text[] NOT NULL DEFAULT '{}' CHECK (cardinality(features_fr) <= 12),
  desktop_image text CHECK (desktop_image ~ '^(https://|/)[^\s]+$' AND char_length(desktop_image) <= 2048),
  mobile_image text CHECK (mobile_image ~ '^(https://|/)[^\s]+$' AND char_length(mobile_image) <= 2048),
  layout text NOT NULL DEFAULT 'spotlight'
    CHECK (layout IN ('spotlight', 'card', 'band', 'split-left', 'split-right')),
  animation text NOT NULL DEFAULT 'tilt'
    CHECK (animation IN ('rise', 'clip', 'tilt', 'parallax', 'none')),
  accent text NOT NULL DEFAULT 'auto'
    CHECK (accent IN ('auto', 'home', 'services', 'projects', 'studio', 'pricing', 'about', 'faq', 'contact', 'legal')),
  featured_on_home boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id, slug),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE public.showcase_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  url text NOT NULL CHECK (url ~ '^(https://|/)[^\s]+$' AND char_length(url) <= 2048),
  domain text CHECK (char_length(domain) <= 200),
  label_en text CHECK (char_length(label_en) <= 160),
  label_fr text CHECK (char_length(label_fr) <= 160),
  industry_en text CHECK (char_length(industry_en) <= 160),
  industry_fr text CHECK (char_length(industry_fr) <= 160),
  location_en text CHECK (char_length(location_en) <= 160),
  location_fr text CHECK (char_length(location_fr) <= 160),
  year text CHECK (char_length(year) <= 20),
  project_status_en text CHECK (char_length(project_status_en) <= 80),
  project_status_fr text CHECK (char_length(project_status_fr) <= 80),
  scope_en text CHECK (char_length(scope_en) <= 300),
  scope_fr text CHECK (char_length(scope_fr) <= 300),
  summary_en text CHECK (char_length(summary_en) <= 2000),
  summary_fr text CHECK (char_length(summary_fr) <= 2000),
  what_we_built_en text[] NOT NULL DEFAULT '{}' CHECK (cardinality(what_we_built_en) <= 20),
  what_we_built_fr text[] NOT NULL DEFAULT '{}' CHECK (cardinality(what_we_built_fr) <= 20),
  tags_en text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags_en) <= 12),
  tags_fr text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags_fr) <= 12),
  -- Optional "How it came together" override: one step per line, "Title: text".
  steps_en text CHECK (char_length(steps_en) <= 4000),
  steps_fr text CHECK (char_length(steps_fr) <= 4000),
  card_title text CHECK (char_length(card_title) <= 200),
  card_badge_en text CHECK (char_length(card_badge_en) <= 200),
  card_badge_fr text CHECK (char_length(card_badge_fr) <= 200),
  card_description_en text CHECK (char_length(card_description_en) <= 2000),
  card_description_fr text CHECK (char_length(card_description_fr) <= 2000),
  card_cta_en text CHECK (char_length(card_cta_en) <= 120),
  card_cta_fr text CHECK (char_length(card_cta_fr) <= 120),
  cover_image text CHECK (cover_image ~ '^(https://|/)[^\s]+$' AND char_length(cover_image) <= 2048),
  desktop_image text CHECK (desktop_image ~ '^(https://|/)[^\s]+$' AND char_length(desktop_image) <= 2048),
  mobile_image text CHECK (mobile_image ~ '^(https://|/)[^\s]+$' AND char_length(mobile_image) <= 2048),
  gallery_images text[] NOT NULL DEFAULT '{}' CHECK (cardinality(gallery_images) <= 12),
  image_alt_en text CHECK (char_length(image_alt_en) <= 300),
  image_alt_fr text CHECK (char_length(image_alt_fr) <= 300),
  mobile_alt_en text CHECK (char_length(mobile_alt_en) <= 300),
  mobile_alt_fr text CHECK (char_length(mobile_alt_fr) <= 300),
  gallery_captions_en text[] NOT NULL DEFAULT '{}' CHECK (cardinality(gallery_captions_en) <= 12),
  gallery_captions_fr text[] NOT NULL DEFAULT '{}' CHECK (cardinality(gallery_captions_fr) <= 12),
  case_study boolean NOT NULL DEFAULT true,
  layout text NOT NULL DEFAULT 'spotlight'
    CHECK (layout IN ('spotlight', 'card', 'band', 'split-left', 'split-right')),
  animation text NOT NULL DEFAULT 'tilt'
    CHECK (animation IN ('rise', 'clip', 'tilt', 'parallax', 'none')),
  accent text NOT NULL DEFAULT 'auto'
    CHECK (accent IN ('auto', 'home', 'services', 'projects', 'studio', 'pricing', 'about', 'faq', 'contact', 'legal')),
  featured_on_home boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id, slug),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE public.showcase_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id text NOT NULL,
  organization_id uuid NOT NULL,
  page text NOT NULL
    CHECK (page IN ('home', 'services', 'projects', 'studio', 'about', 'pricing', 'faq', 'contact')),
  section_key text NOT NULL CHECK (section_key ~ '^[a-z][a-z0-9-]{0,39}$'),
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  eyebrow_en text CHECK (char_length(eyebrow_en) <= 200),
  eyebrow_fr text CHECK (char_length(eyebrow_fr) <= 200),
  title_en text CHECK (char_length(title_en) <= 300),
  title_fr text CHECK (char_length(title_fr) <= 300),
  body_en text CHECK (char_length(body_en) <= 2000),
  body_fr text CHECK (char_length(body_fr) <= 2000),
  animation text NOT NULL DEFAULT 'auto'
    CHECK (animation IN ('auto', 'rise', 'clip', 'tilt', 'parallax', 'none')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id, page, section_key),
  FOREIGN KEY (website_id, organization_id)
    REFERENCES public.websites (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX showcase_templates_site_idx ON public.showcase_templates (website_id, organization_id, sort_order);
CREATE INDEX showcase_templates_org_idx ON public.showcase_templates (organization_id);
CREATE INDEX showcase_projects_site_idx ON public.showcase_projects (website_id, organization_id, sort_order);
CREATE INDEX showcase_projects_org_idx ON public.showcase_projects (organization_id);
CREATE INDEX showcase_sections_org_idx ON public.showcase_sections (organization_id);

CREATE TRIGGER showcase_templates_set_updated_at BEFORE UPDATE ON public.showcase_templates
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER showcase_projects_set_updated_at BEFORE UPDATE ON public.showcase_projects
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER showcase_sections_set_updated_at BEFORE UPDATE ON public.showcase_sections
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ============================================================================
-- Privileges and Row Level Security (same model as the other collections)
-- ============================================================================

REVOKE ALL ON public.showcase_templates, public.showcase_projects, public.showcase_sections
  FROM anon, authenticated;
GRANT SELECT ON public.showcase_templates, public.showcase_projects, public.showcase_sections
  TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.showcase_templates, public.showcase_projects,
  public.showcase_sections TO authenticated;

ALTER TABLE public.showcase_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.showcase_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.showcase_sections ENABLE ROW LEVEL SECURITY;

-- Public: published templates / projects of a live website; every section row
-- of a live website (on/off and order are what the site needs to read).
CREATE POLICY showcase_templates_public_read ON public.showcase_templates
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND private.is_website_live(website_id));
CREATE POLICY showcase_projects_public_read ON public.showcase_projects
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND private.is_website_live(website_id));
CREATE POLICY showcase_sections_public_read ON public.showcase_sections
  FOR SELECT TO anon, authenticated
  USING (private.is_website_live(website_id));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['showcase_templates', 'showcase_projects', 'showcase_sections'] LOOP
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
    -- Read-only while a required contract waits for signature (as site content).
    EXECUTE format(
      'CREATE POLICY %1$I ON public.%2$I AS RESTRICTIVE FOR INSERT TO authenticated
         WITH CHECK (NOT private.org_contract_locked(organization_id))', t || '_contract_insert', t);
    EXECUTE format(
      'CREATE POLICY %1$I ON public.%2$I AS RESTRICTIVE FOR UPDATE TO authenticated
         USING (NOT private.org_contract_locked(organization_id))
         WITH CHECK (NOT private.org_contract_locked(organization_id))', t || '_contract_update', t);
    EXECUTE format(
      'CREATE POLICY %1$I ON public.%2$I AS RESTRICTIVE FOR DELETE TO authenticated
         USING (NOT private.org_contract_locked(organization_id))', t || '_contract_delete', t);
    -- Live site updates: ping the site's /api/revalidate after commit.
    EXECUTE format(
      'CREATE TRIGGER revalidate_site AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION private.ping_site_revalidate(%L)', t, 'website_id');
  END LOOP;
END $$;
