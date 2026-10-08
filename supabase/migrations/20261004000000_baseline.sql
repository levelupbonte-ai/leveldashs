-- Baseline: schema that already existed in production before versioned migrations.
-- Source: app.levelup-ecosystem/supabase-schema.sql (DDL + RLS sections only, seed data excluded),
-- plus idx_legal_slug which exists in production but not in that file.
-- Idempotent: safe to re-run.


-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 2. PARAMÈTRES GLOBAUX DU SITE (Site Settings)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.site_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 3. PROJETS & ÉTUDES DE CAS (Portfolio / Case Studies)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.projects (
    id TEXT PRIMARY KEY,
    step TEXT NOT NULL DEFAULT '01',
    badge TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    image TEXT NOT NULL,
    href TEXT NOT NULL,
    external BOOLEAN DEFAULT false,
    aspect_ratio TEXT DEFAULT 'aspect-[639/298]',
    cta_text TEXT NOT NULL DEFAULT 'Explore',
    order_index INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 4. PLANS TARIFAIRES (Pricing Plans & Care Plans)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.pricing_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subtitle TEXT,
    badge TEXT,
    price TEXT NOT NULL,
    price_period TEXT NOT NULL DEFAULT '/one-time',
    secondary_note TEXT,
    description TEXT NOT NULL,
    short_points TEXT[] NOT NULL DEFAULT '{}',
    full_features JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_recommended BOOLEAN DEFAULT false,
    cta_text TEXT NOT NULL DEFAULT 'Book Architecture Call',
    cta_href TEXT NOT NULL DEFAULT '/book',
    order_index INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 5. ANNUAIRE D'ENTITÉS & KNOWLEDGE GRAPH (Programmatic SEO)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    subtitle TEXT,
    entity_type TEXT NOT NULL DEFAULT 'person',
    category TEXT NOT NULL DEFAULT 'General',
    short_bio TEXT NOT NULL,
    full_content TEXT,
    avatar_url TEXT,
    banner_url TEXT,
    website_url TEXT,
    social_links JSONB DEFAULT '{}'::jsonb,
    structured_data_override JSONB,
    tags TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
    views_count BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 6. FOIRE AUX QUESTIONS (FAQs par catégories)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.faqs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL, -- 'About LevelUp Ecosystem', 'Services & Google Ranking', 'Security & Pricing'
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    order_index INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 7. TÉMOIGNAGES CLIENTS (Testimonials & Social Proof)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.testimonials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author TEXT NOT NULL,
    role TEXT NOT NULL,
    company TEXT NOT NULL,
    quote TEXT NOT NULL,
    image TEXT NOT NULL,
    rating INT DEFAULT 5,
    order_index INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 8. CONTACTS, LEADS & DEMANDES D'APERÇU MOBILE (Form Submissions)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT,
    employees TEXT,
    message TEXT,
    is_waitlisted BOOLEAN DEFAULT false,
    queue_position INT DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'in_progress', 'closed')),
    source TEXT DEFAULT 'website_contact',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 9. RÉSERVATIONS & CONFIRMATIONS RSVP (Bookings & RSVPs)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL DEFAULT 'consultation' CHECK (type IN ('consultation', 'wedding_rsvp', 'preview_call')),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    invite_code TEXT,
    slot_time TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
    meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 10. DOCUMENTS LÉGAUX (Legal Documents: Terms, Privacy, Cookies)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.legal_documents (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT,
    last_updated TEXT NOT NULL,
    content_markdown TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 11. TABLES SPÉCIFIQUES POUR LEVELSTUDIO (Studio Projects & Generations)
-- Compatible avec https://github.com/levelupbonte-ai/levelstudio
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.studio_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID, -- lié à auth.users si utilisé
    title TEXT NOT NULL,
    framework TEXT NOT NULL DEFAULT 'nextjs',
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'completed', 'error')),
    preview_url TEXT,
    github_repo TEXT,
    config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.studio_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.studio_projects(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL, -- 'image', 'component', 'code', 'export'
    url TEXT NOT NULL,
    file_size BIGINT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 12. INDEXATION HAUTE PERFORMANCE (Sub-millisecond Queries)
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects (status, order_index);
CREATE INDEX IF NOT EXISTS idx_pricing_status ON public.pricing_plans (status, order_index);
CREATE INDEX IF NOT EXISTS idx_entities_slug ON public.entities (slug);
CREATE INDEX IF NOT EXISTS idx_entities_status ON public.entities (status);
CREATE INDEX IF NOT EXISTS idx_faqs_category ON public.faqs (category, order_index);
CREATE INDEX IF NOT EXISTS idx_testimonials_order ON public.testimonials (status, order_index);
CREATE INDEX IF NOT EXISTS idx_leads_created ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON public.bookings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_projects_user ON public.studio_projects (user_id);

-- ==============================================================================
-- 13. SÉCURITÉ ROW LEVEL SECURITY (RLS)
-- ==============================================================================
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_assets ENABLE ROW LEVEL SECURITY;

-- Politiques de lecture publique (Site Web & Moteurs de recherche)
DROP POLICY IF EXISTS "Public read settings" ON public.site_settings;
CREATE POLICY "Public read settings" ON public.site_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read projects" ON public.projects;
CREATE POLICY "Public read projects" ON public.projects FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "Public read pricing" ON public.pricing_plans;
CREATE POLICY "Public read pricing" ON public.pricing_plans FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "Public read entities" ON public.entities;
CREATE POLICY "Public read entities" ON public.entities FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "Public read faqs" ON public.faqs;
CREATE POLICY "Public read faqs" ON public.faqs FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "Public read testimonials" ON public.testimonials;
CREATE POLICY "Public read testimonials" ON public.testimonials FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "Public read legal" ON public.legal_documents;
CREATE POLICY "Public read legal" ON public.legal_documents FOR SELECT USING (status = 'published');

-- Autoriser les visiteurs à soumettre un contact ou réserver (INSERT Public)
DROP POLICY IF EXISTS "Public submit leads" ON public.leads;
CREATE POLICY "Public submit leads" ON public.leads FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public submit bookings" ON public.bookings;
CREATE POLICY "Public submit bookings" ON public.bookings FOR INSERT WITH CHECK (true);

-- Politiques Admin Backend (Accès total pour la clé secrète service_role)
DROP POLICY IF EXISTS "Admin write settings" ON public.site_settings;
CREATE POLICY "Admin write settings" ON public.site_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin write projects" ON public.projects;
CREATE POLICY "Admin write projects" ON public.projects FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin write pricing" ON public.pricing_plans;
CREATE POLICY "Admin write pricing" ON public.pricing_plans FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin write entities" ON public.entities;
CREATE POLICY "Admin write entities" ON public.entities FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin write faqs" ON public.faqs;
CREATE POLICY "Admin write faqs" ON public.faqs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin write testimonials" ON public.testimonials;
CREATE POLICY "Admin write testimonials" ON public.testimonials FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin write leads" ON public.leads;
CREATE POLICY "Admin write leads" ON public.leads FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin write bookings" ON public.bookings;
CREATE POLICY "Admin write bookings" ON public.bookings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin write legal" ON public.legal_documents;
CREATE POLICY "Admin write legal" ON public.legal_documents FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin write studio projects" ON public.studio_projects;
CREATE POLICY "Admin write studio projects" ON public.studio_projects FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin write studio assets" ON public.studio_assets;
CREATE POLICY "Admin write studio assets" ON public.studio_assets FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_legal_slug ON public.legal_documents (slug);
