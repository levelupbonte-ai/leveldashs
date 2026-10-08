import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { getDashboardSession } from '@/lib/auth/session';
import { hasRole } from '@/lib/auth/types';
import { createClient } from '@/lib/supabase/server';

const ALLOWED_ORIGINS = new Set([
  'https://dashboard.levelup-ecosystem.com',
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000'])
]);

/**
 * Shared checks for the dashboard AI endpoints: JSON sent by the dashboard itself
 * (cookies are shared with the other LevelUp subdomains), a signed-in user with
 * an active site, and one unit of the organization's daily AI allowance.
 */
export async function guardAssistantRequest(request: NextRequest) {
  const origin = request.headers.get('origin');
  let sameHost = false;
  try {
    sameHost = !!origin && new URL(origin).host === request.headers.get('host');
  } catch {
    sameHost = false;
  }
  if (
    !request.headers.get('content-type')?.startsWith('application/json') ||
    !origin ||
    !(sameHost || ALLOWED_ORIGINS.has(origin))
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
