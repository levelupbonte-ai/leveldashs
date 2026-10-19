import { NextResponse, type NextRequest } from 'next/server';
import * as z from 'zod';
import { getTranslatorFor } from '@/i18n/messages';
import { sendNotice } from '@/lib/email/notice';
import { DASHBOARD_URL, isUuid } from '@/features/contracts/server/http';
import { createClient } from '@/lib/supabase/server';
import { readJsonBody } from '@/lib/validation/http';

// No parameters besides the id: the body must be exactly `{}`.
const Body = z.strictObject({});

// LevelUp staff send a draft contract: the database checks the caller (platform
// admin, aal2), freezes the snapshot and returns the owners/admins to notify.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Same origin (CSRF), JSON only, empty object only.
  const body = await readJsonBody(request, Body, { maxBytes: 64 });
  if (!body.ok) return body.response;
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const db = await createClient();
  const { data, error } = await db.rpc('admin_send_contract', { p_contract_id: id });
  if (error) {
    // Codes only: the database message stays in the server logs.
    console.error('admin_send_contract failed', error.code);
    const mfa = error.message.includes('aal2');
    return NextResponse.json(
      { error: mfa ? 'mfa' : error.code === 'PT403' ? 'forbidden' : 'failed' },
      { status: mfa || error.code === 'PT403' ? 403 : 400 }
    );
  }
  const result = data as {
    title: string;
    organization_name: string;
    recipients: { email: string; locale: string | null }[];
  };
  let notified = 0;
  for (const recipient of result.recipients ?? []) {
    const { locale, t } = await getTranslatorFor(recipient.locale);
    const ok = await sendNotice({
      to: recipient.email,
      locale,
      subject: t('emails.contract.sentSubject'),
      title: t('emails.contract.sentTitle'),
      lines: [
        t('emails.contract.sentLine1', {
          title: result.title,
          organization: result.organization_name
        }),
        t('emails.contract.sentLine2')
      ],
      cta: { label: t('emails.contract.sentCta'), url: `${DASHBOARD_URL}/dashboard/contract` }
    });
    if (ok) notified++;
  }
  return NextResponse.json({
    status: 'sent',
    notified,
    recipients: result.recipients?.length ?? 0
  });
}
