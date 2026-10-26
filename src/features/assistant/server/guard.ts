import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { getDashboardSession } from '@/lib/auth/session';
import { hasRole } from '@/lib/auth/types';
import { planLimitFromDb } from '@/lib/plan-limit';
import { createClient } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/validation/http';

export const ASSISTANT_ORIGINS = new Set([
  'https://dashboard.levelup-ecosystem.com',
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000'])
]);

/**
 * Shared checks for the dashboard AI endpoints: JSON sent by the dashboard itself
 * (cookies are shared with the other LevelUp subdomains), a signed-in user with
 * an active site, and one unit of the organization's AI allowance (60 a day, and
 * the monthly requests of its plan).
 */
export async function guardAssistantRequest(request: NextRequest) {
  if (
    !request.headers.get('content-type')?.startsWith('application/json') ||
    !isSameOrigin(request, ASSISTANT_ORIGINS)
  ) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  const session = await getDashboardSession();
  if (!session) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  const { activeOrg, activeWebsite, isPlatformAdmin } = session;
  if (!activeOrg || !activeWebsite) {
    return { error: NextResponse.json({ error: 'no_website' }, { status: 400 }) };
  }

  const db = await createClient();
  // Daily allowance per organization (database-enforced), checked before any AI call.
  const { data: remaining, error: quotaError } = await db.rpc('assistant_consume', {
    p_organization_id: activeOrg.id
  });
  if (quotaError) {
    // Monthly allowance of the organization's plan: the UI offers an upgrade.
    const planLimit = planLimitFromDb(quotaError);
    if (planLimit) {
      return {
        error: NextResponse.json({ error: 'plan_limit', limit: planLimit }, { status: 402 })
      };
    }
    const limited = quotaError.code === 'PT429';
    return {
      error: NextResponse.json(
        { error: limited ? 'limit' : 'forbidden' },
        { status: limited ? 429 : 403 }
      )
    };
  }
  return {
    db,
    website: activeWebsite,
    remaining: remaining as number,
    canEdit: isPlatformAdmin || hasRole(activeOrg.role, 'editor')
  };
}
