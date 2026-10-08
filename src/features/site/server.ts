import 'server-only';
import { requireDashboardSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { featureEnabled } from './config/collections';

/**
 * Resolves the active website for a /dashboard/site page and returns the
 * cookie-bound Supabase client for server prefetching. `feature` hides the
 * page when the website does not have that feature enabled.
 */
export async function loadSitePage(feature?: string | string[]) {
  const session = await requireDashboardSession();
  const website = session.activeWebsite;
  if (!website || !session.activeOrg) return { status: 'no-website' as const, session };
  if (!featureEnabled(feature, website.features)) return { status: 'disabled' as const, session };
  return {
    status: 'ok' as const,
    session,
    website,
    db: await createClient()
  };
}
