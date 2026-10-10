import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getTranslatorFor } from '@/i18n/messages';
import { sendNotice } from '@/lib/email/notice';
import { createClient } from '@/lib/supabase/server';

// LevelUp staff approve or reject an access request. The database checks the
// caller (platform admin, 2FA session); the applicant is told by e-mail.

const Body = z.object({
  userId: z.string().uuid(),
  approve: z.boolean(),
  organizationId: z.string().uuid().optional()
});

const DASHBOARD = 'https://dashboard.levelup-ecosystem.com';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  let sameHost = false;
  try {
    sameHost = !!origin && new URL(origin).host === request.headers.get('host');
  } catch {
    sameHost = false;
  }
  if (!sameHost) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
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
