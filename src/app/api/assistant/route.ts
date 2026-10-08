import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { runAssistant } from '@/features/assistant/server/assistant';
import { getDashboardSession } from '@/lib/auth/session';
import { hasRole } from '@/lib/auth/types';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).max(4000) }))
    .min(1)
    .max(20)
});

export async function POST(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { activeOrg, activeWebsite, isPlatformAdmin } = session;
  if (!activeOrg || !activeWebsite) {
    return NextResponse.json({ error: 'no_website' }, { status: 400 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const messages = parsed.data.messages.slice(-12);
  if (messages.at(-1)?.role !== 'user')
    return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const db = await createClient();
  // Daily allowance per organization (database-enforced), checked before any AI call.
  const { data: remaining, error: quotaError } = await db.rpc('assistant_consume', {
    p_organization_id: activeOrg.id
  });
  if (quotaError) {
    const limited = quotaError.code === 'PT429';
    return NextResponse.json(
      { error: limited ? 'limit' : 'forbidden' },
      { status: limited ? 429 : 403 }
    );
  }

  try {
    const result = await runAssistant({
      db,
      websiteId: activeWebsite.id,
      siteName: activeWebsite.name,
      canEdit: isPlatformAdmin || hasRole(activeOrg.role, 'editor'),
      messages
    });
    return NextResponse.json({ ...result, remaining });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
