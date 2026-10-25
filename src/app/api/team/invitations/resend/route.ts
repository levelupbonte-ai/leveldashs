import { NextResponse, type NextRequest } from 'next/server';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { dbErrorCode, ERROR_STATUS } from '@/lib/access/db-errors';
import { sendInvitationEmail, type InvitationPayload } from '@/lib/email/access-emails';
import { createClient } from '@/lib/supabase/server';
import { readJsonBody } from '@/lib/validation/http';

// Re-sends an invitation with a new link (the previous one stops working).
// Rate limited in the database: one re-send per 2 minutes, 5 per day.

const Body = z.strictObject({ invitationId: z.uuid() });

export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, Body, { maxBytes: 256 });
  if (!parsed.ok) return parsed.response;
  const db = await createClient();
  const { data, error } = await db.rpc('resend_organization_invitation', {
    p_invitation_id: parsed.data.invitationId
  });
  if (error) {
    const code = dbErrorCode(error, 'inviteFailed');
    console.error('resend_organization_invitation failed', error.code, code);
    return NextResponse.json({ error: code }, { status: ERROR_STATUS[code] ?? 400 });
  }
  const payload = data as InvitationPayload;
  const sent = await sendInvitationEmail(payload, await getLocale());
  await db.rpc('record_organization_invitation_email', {
    p_invitation_id: payload.invitation_id,
    p_sent: sent
  });
  return NextResponse.json(
    { status: sent ? 'sent' : 'email_failed', invitationId: payload.invitation_id },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
