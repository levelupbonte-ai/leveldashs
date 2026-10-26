import { NextResponse, type NextRequest } from 'next/server';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { dbErrorCode, ERROR_STATUS } from '@/lib/access/db-errors';
import { sendInvitationEmail, type InvitationPayload } from '@/lib/email/access-emails';
import { planLimitFromDb } from '@/lib/plan-limit';
import { createClient } from '@/lib/supabase/server';
import { fields } from '@/lib/validation/fields';
import { readJsonBody } from '@/lib/validation/http';

// An owner or admin invites someone to the team. The database checks the role,
// aal2, the e-mail, duplicates and the daily limit, stores only the hash of a
// single-use 7-day token and returns the token once; it is e-mailed from here
// and never sent back to the browser. The answer says whether Resend accepted
// the e-mail ("sent") or not ("email_failed"), never "sent" when it failed.

const Body = z.strictObject({
  organizationId: z.uuid(),
  email: fields.email({ required: true }),
  role: z.enum(['owner', 'admin', 'editor', 'viewer'])
});

export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, Body, { maxBytes: 1024 });
  if (!parsed.ok) return parsed.response;
  const db = await createClient();
  const { data, error } = await db.rpc('create_organization_invitation', {
    p_organization_id: parsed.data.organizationId,
    p_email: parsed.data.email,
    p_role: parsed.data.role
  });
  if (error) {
    const code = dbErrorCode(error, 'inviteFailed');
    console.error('create_organization_invitation failed', error.code, code);
    // Plan seat limit: the UI says how many seats the plan allows (key + limit only).
    const limit = planLimitFromDb(error);
    return NextResponse.json(limit ? { error: code, limit } : { error: code }, {
      status: ERROR_STATUS[code] ?? 400
    });
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
