import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { dbErrorResponse, noStore, UUID } from '@/features/email-campaigns/server/http';
import {
  emailProviderConfigured,
  processCampaign,
  userSender
} from '@/features/email-campaigns/server/sender';
import { createClient } from '@/lib/supabase/server';
import { errorResponse, readJsonBody } from '@/lib/validation/http';

// Owners and admins (aal2 when enrolled): starts a campaign. The database
// checks the role, the content, the postal address, the plan quota, the daily
// cap and the pause switch, then snapshots the subscribed contacts. The first
// batches go out right away; the page keeps calling /process (and the worker
// continues in the background) until every batch is sent.

export const maxDuration = 60;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = await readJsonBody(request, z.strictObject({}), { maxBytes: 64 });
  if (!body.ok) return body.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return errorResponse(404, 'not_found');
  if (!emailProviderConfigured()) return errorResponse(503, 'emailNotConfigured');

  const db = await createClient();
  const { data, error } = await db.rpc('email_campaign_send', { p_campaign_id: id });
  if (error) return dbErrorResponse(error);
  const recipients = (data as { recipients: number }).recipients;
  const progress = await processCampaign(userSender(db), id, 25_000).catch(() => ({
    status: 'sending' as const,
    sent: 0
  }));
  return NextResponse.json({ ...progress, recipients }, { headers: noStore });
}
