import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getTranslatorFor } from '@/i18n/messages';
import { sendNotice } from '@/lib/email/notice';
import { createClient } from '@/lib/supabase/server';
import { readJsonBody } from '@/lib/validation/http';

// LevelUp staff approve or reject an access request. The database checks the
// caller (platform admin, 2FA session); the applicant is told by e-mail.

const Body = z.strictObject({
  userId: z.uuid(),
  approve: z.boolean(),
  organizationId: z.uuid().optional()
});

const DASHBOARD = 'https://dashboard.levelup-ecosystem.com';

export async function POST(request: NextRequest) {
  // Same origin (CSRF), JSON only, 1 KB at most, unknown keys refused.
  const parsed = await readJsonBody(request, Body, { maxBytes: 1024 });
  if (!parsed.ok) return parsed.response;
  const db = await createClient();
  const { data, error } = await db.rpc('review_access_request', {
    p_user_id: parsed.data.userId,
    p_approve: parsed.data.approve,
    p_organization_id: parsed.data.organizationId ?? null
  });
  if (error) {
    // Codes only: the database message stays in the server logs.
    console.error('review_access_request failed', error.code);
    const mfa = error.message.includes('aal2');
    return NextResponse.json(
      { error: mfa ? 'mfa' : error.code === 'PT403' ? 'forbidden' : 'failed' },
      { status: mfa || error.code === 'PT403' ? 403 : 400 }
    );
  }
  const result = data as { status: string; email?: string; locale?: string | null };
  if (result.email) {
    // The applicant's language when they chose one, English otherwise.
    const { locale, t } = await getTranslatorFor(result.locale);
    await sendNotice(
      parsed.data.approve
        ? {
            to: result.email,
            locale,
            subject: t('emails.accessApproved.subject'),
            title: t('emails.accessApproved.title'),
            lines: [t('emails.accessApproved.line1'), t('emails.accessApproved.line2')],
            cta: { label: t('emails.accessApproved.cta'), url: `${DASHBOARD}/dashboard/site` }
          }
        : {
            to: result.email,
            locale,
            subject: t('emails.accessRejected.subject'),
            title: t('emails.accessRejected.title'),
            lines: [t('emails.accessRejected.line1'), t('emails.accessRejected.line2')]
          }
    );
  }
  return NextResponse.json({ status: result.status });
}
