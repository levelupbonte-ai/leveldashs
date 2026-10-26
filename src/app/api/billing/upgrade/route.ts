import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getTranslatorFor } from '@/i18n/messages';
import { DASHBOARD_URL } from '@/lib/email/access-emails';
import { sendNotice, TEAM_INBOX } from '@/lib/email/notice';
import { createClient } from '@/lib/supabase/server';
import { readJsonBody } from '@/lib/validation/http';

// An owner or admin asks LevelUp for another plan from Billing. Not a payment:
// the database checks the role, the plan and the rate limit and stores one
// pending request per organization (request_plan_upgrade); the LevelUp team gets
// an e-mail and decides on /dashboard/exclusive/billing.

const Body = z.strictObject({
  organizationId: z.uuid(),
  planKey: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  message: z.string().max(1000).optional()
});

const CODES: Record<string, string> = {
  plan_not_found: 'planNotFound',
  already_on_plan: 'alreadyOnPlan'
};

export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, Body, { maxBytes: 4 * 1024 });
  if (!parsed.ok) return parsed.response;
  const db = await createClient();
  const { data, error } = await db.rpc('request_plan_upgrade', {
    p_org: parsed.data.organizationId,
    p_plan_key: parsed.data.planKey,
    p_message: parsed.data.message ?? null
  });
  if (error) {
    const code =
      CODES[error.message] ??
      (error.code === 'PT429'
        ? 'rateLimited'
        : error.code === 'PT403'
          ? 'forbidden'
          : 'saveFailed');
    console.error('request_plan_upgrade failed', error.code, code);
    return NextResponse.json(
      { error: code },
      {
        status: code === 'forbidden' ? 403 : code === 'rateLimited' ? 429 : 400
      }
    );
  }
  const result = data as {
    already: boolean;
    organization_name?: string;
    plan_name?: string;
    from_plan_name?: string | null;
    message?: string | null;
  };
  if (!result.already) {
    // Internal notice: always in English, the ecosystem's official language.
    const { t } = await getTranslatorFor('en');
    const {
      data: { user }
    } = await db.auth.getUser();
    await sendNotice({
      to: TEAM_INBOX,
      locale: 'en',
      subject: t('emails.upgradeRequestTeam.subject', {
        organization: result.organization_name ?? '',
        plan: result.plan_name ?? ''
      }),
      title: t('emails.upgradeRequestTeam.title'),
      lines: [
        t('emails.upgradeRequestTeam.organization', {
          value: result.organization_name ?? ''
        }),
        t('emails.upgradeRequestTeam.plan', {
          from: result.from_plan_name ?? '—',
          to: result.plan_name ?? ''
        }),
        t('emails.upgradeRequestTeam.account', { value: user?.email ?? '' }),
        ...(result.message
          ? [t('emails.upgradeRequestTeam.message', { value: result.message })]
          : [])
      ],
      cta: {
        label: t('emails.upgradeRequestTeam.cta'),
        url: `${DASHBOARD_URL}/dashboard/exclusive/billing`
      }
    }).catch(() => false);
  }
  return NextResponse.json(
    { status: result.already ? 'already' : 'requested' },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
