-- Table privileges no policy uses (security hardening). Row level security
-- already refuses these writes; the grants are removed as well so a future
-- policy mistake cannot open them. No behaviour change for the apps:
--   - legacy tables (entities, faqs, legal_documents, pricing_plans, projects,
--     site_settings, testimonials) are written by the service role only;
--   - ai_usage is written by SECURITY DEFINER functions only;
--   - organization_invitations: nothing for anon (writes need a signed-in admin).
revoke insert, update, delete on table
  public.entities, public.faqs, public.legal_documents, public.pricing_plans,
  public.projects, public.site_settings, public.testimonials, public.ai_usage
from anon, authenticated;

revoke insert, update, delete on table public.organization_invitations from anon;
