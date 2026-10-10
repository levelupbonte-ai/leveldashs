import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getLocale } from 'next-intl/server';
import { userLocale } from '@/i18n/config';
import { getTranslatorFor } from '@/i18n/messages';
import { sendNotice, TEAM_INBOX } from '@/lib/email/notice';
import { createClient } from '@/lib/supabase/server';

// A new account asks for dashboard access: the request is stored by the database
// (submit_access_request decides; status is never the user's to set) and the
// LevelUp team gets an e-mail.

const Body = z.object({
  businessName: z.string().trim().min(2).max(120),
  website: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  message: z.string().trim().max(1000).optional()
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
  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: previous } = await db
    .from('access_requests')
    .select('status')
    .eq('user_id', user.id)
    .maybeSingle();
  const { data: status, error } = await db.rpc('submit_access_request', {
    p_business_name: parsed.data.businessName,
    p_website: parsed.data.website || null,
    p_phone: parsed.data.phone || null,
    p_message: parsed.data.message || null
  });
  if (error) {
    console.error('submit_access_request failed', error.code);
    return NextResponse.json(
      { error: error.code === 'PT403' ? 'unverified' : 'invalid' },
      { status: error.code === 'PT403' ? 403 : 400 }
    );
  }
  // Remember the applicant's language so the decision e-mail is in it.
  if (!userLocale(user)) {
    await db.auth.updateUser({ data: { locale: await getLocale() } }).catch(() => undefined);
  }
  // One e-mail to the team per new request (not for edits of a pending one).
  // Internal notice: always in English, the ecosystem's official language.
  if (status === 'pending' && !previous) {
    const { t } = await getTranslatorFor('en');
    const d = parsed.data;
    await sendNotice({
      to: TEAM_INBOX,
      locale: 'en',
      subject: t('emails.accessRequestTeam.subject', { business: d.businessName }),
      title: t('emails.accessRequestTeam.title'),
      lines: [
        t('emails.accessRequestTeam.business', { value: d.businessName }),
        t('emails.accessRequestTeam.account', { value: user.email ?? '' }),
        ...(d.website ? [t('emails.accessRequestTeam.website', { value: d.website })] : []),
        ...(d.phone ? [t('emails.accessRequestTeam.phone', { value: d.phone })] : []),
        ...(d.message ? [t('emails.accessRequestTeam.message', { value: d.message })] : [])
      ],
      cta: { label: t('emails.accessRequestTeam.cta'), url: `${DASHBOARD}/dashboard/exclusive` }
    });
  }
  return NextResponse.json({ status });
}
