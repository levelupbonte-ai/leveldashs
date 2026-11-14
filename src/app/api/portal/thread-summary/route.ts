import { NextResponse, type NextRequest } from 'next/server';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { logAiCall } from '@/lib/ai/router';
import { createClient } from '@/lib/supabase/server';
import { fields } from '@/lib/validation/fields';
import { readJsonBody } from '@/lib/validation/http';
import type {
  PortalMessage,
  PortalThreadSummary,
  PortalThreadSummaryState
} from '@/features/client-portal/api/types';
import { summarizeThread } from '@/features/client-portal/server/thread-summary';

// AI summary of a member's conversation for the team (client portal and chat).
// Everything runs as the signed-in editor: the database checks the role
// (portal_admin_thread_summary / _save, editor+, 60 summaries per hour) and keeps
// the summary until the member writes again, so opening a thread twice costs
// one AI call at most.

export const maxDuration = 30;

const Body = z.strictObject({
  customerId: fields.uuid(),
  refresh: z.boolean().optional()
});

const noStore = { headers: { 'Cache-Control': 'no-store' } };

export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, Body, { maxBytes: 256 });
  if (!parsed.ok) return parsed.response;
  const { customerId, refresh } = parsed.data;
  const db = await createClient();

  const state = await db.rpc('portal_admin_thread_summary', { p_customer_id: customerId });
  if (state.error) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const current = state.data as PortalThreadSummaryState & {
    stale: boolean;
    last_message: string | null;
  };
  const keep = (summary: PortalThreadSummary | null, at: string | null) =>
    NextResponse.json({ summary, at, has_messages: current.has_messages }, noStore);
  if (!current.has_messages || !current.last_message) return keep(null, null);
  if (!current.stale && !refresh) return keep(current.summary, current.at);

  const thread = await db.rpc('portal_admin_thread', { p_customer_id: customerId });
  if (thread.error) return keep(current.summary, current.at);
  const messages = (thread.data ?? []) as PortalMessage[];
  const locale = (await getLocale()) === 'fr' ? 'fr' : 'en';
  try {
    const out = await summarizeThread(messages, locale, null);
    if (!out) return keep(current.summary, current.at);
    const saved = await db.rpc('portal_admin_thread_summary_save', {
      p_customer_id: customerId,
      p_upto: current.last_message,
      p_summary: out.summary
    });
    void logAiCall(db, 'reports', out.target);
    // Rate limited or refused: still show this summary once.
    return keep(out.summary, saved.error ? current.at : new Date().toISOString());
  } catch {
    // AI unavailable: the last summary (possibly older) is better than nothing.
    return keep(current.summary, current.at);
  }
}
