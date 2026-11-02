import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { EmailBrand } from '@/features/email-campaigns/api/types';
import { dbErrorResponse, noStore, UUID } from '@/features/email-campaigns/server/http';
import {
  emailProviderConfigured,
  sendTest,
  type CampaignRow
} from '@/features/email-campaigns/server/sender';
import { createClient } from '@/lib/supabase/server';
import { errorResponse, readJsonBody } from '@/lib/validation/http';

// Editors and up: the campaign as an e-mail to their own address. The database
// checks the role, the content, the postal address, the quota, the daily cap
// and 10 tests per hour, and gives the address (the browser cannot choose it).

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = await readJsonBody(request, z.strictObject({}), { maxBytes: 64 });
  if (!body.ok) return body.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return errorResponse(404, 'not_found');
  if (!emailProviderConfigured()) return errorResponse(503, 'emailNotConfigured');

  const db = await createClient();
  const { data, error } = await db.rpc('email_campaign_test', { p_campaign_id: id });
  if (error) return dbErrorResponse(error);
  const test = data as { to: string; campaign: CampaignRow; sender: EmailBrand };
  const sent = await sendTest(test.to, test.campaign, test.sender).catch(() => false);
  if (!sent) return errorResponse(502, 'emailSendFailed');
  return NextResponse.json({ status: 'sent', to: test.to }, { headers: noStore });
}
