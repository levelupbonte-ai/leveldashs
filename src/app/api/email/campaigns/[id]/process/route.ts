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

// Owners and admins: sends the next batches of a campaign being sent (called by
// the page while it is open). Batches are leased by the database, so this can
// run next to the worker without sending anything twice.

export const maxDuration = 60;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = await readJsonBody(request, z.strictObject({}), { maxBytes: 64 });
  if (!body.ok) return body.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return errorResponse(404, 'not_found');
  if (!emailProviderConfigured()) return errorResponse(503, 'emailNotConfigured');
  try {
    const progress = await processCampaign(userSender(await createClient()), id, 25_000);
    return NextResponse.json(progress, { headers: noStore });
  } catch (error) {
    return dbErrorResponse(error as { message: string; code?: string });
  }
}
