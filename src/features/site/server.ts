import 'server-only';
import { requireDashboardSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { getSiteCapabilities } from '@/features/insights/api/service';
import type { CapabilityKey } from '@/features/insights/api/types';
import { featureEnabled } from './config/collections';

/**
 * Resolves the active website for a /dashboard/site page and returns the
 * cookie-bound Supabase client for server prefetching. `feature` hides the
 * page when the website does not have that feature enabled, unless
 * `dataKey` is given and the website already has rows of that kind (a site
 * that stores something always sees it, whatever its feature flags).
 */
export async function loadSitePage(feature?: string | string[], dataKey?: CapabilityKey) {
  const session = await requireDashboardSession();
  const website = session.activeWebsite;
  if (!website || !session.activeOrg) return { status: 'no-website' as const, session };
  const db = await createClient();
  if (!featureEnabled(feature, website.features)) {
    const caps = dataKey ? await getSiteCapabilities(db, website.id).catch(() => null) : null;
    if (!dataKey || !caps || !(caps.counts[dataKey] > 0)) {
      return { status: 'disabled' as const, session };
    }
  }
  return { status: 'ok' as const, session, website, db };
}
