import 'server-only';
import { getTranslatorFor } from '@/i18n/messages';
import { sendNotice, type NoticeInput } from './notice';

/** Links in e-mails always point to production (the e-mail outlives any preview). */
export const DASHBOARD_URL = 'https://dashboard.levelup-ecosystem.com';

type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export interface InvitationPayload {
  invitation_id: string;
  organization_id: string;
  organization_name: string;
  website_name: string | null;
  email: string;
  role: Role;
  expires_at: string;
  inviter_name: string;
  invitee_locale: string | null;
  token: string;
}

/** The team invitation e-mail, in the invitee's language when known. */
export async function invitationEmail(
  payload: InvitationPayload,
  fallbackLocale?: string
): Promise<NoticeInput> {
  const { locale, t } = await getTranslatorFor(payload.invitee_locale ?? fallbackLocale);
  const place = payload.website_name
    ? `${payload.organization_name} (${payload.website_name})`
    : payload.organization_name;
  const role = t(`common.roles.${payload.role}`);
  return {
    to: payload.email,
    locale,
    subject: t('emails.teamInvite.subject', {
      inviter: payload.inviter_name,
      organization: payload.organization_name
    }),
    title: t('emails.teamInvite.title', { organization: payload.organization_name }),
    lines: [
      t('emails.teamInvite.line1', { inviter: payload.inviter_name, place, role }),
      t('emails.teamInvite.line2', { email: payload.email })
    ],
    details: [
      { label: t('emails.teamInvite.invitedBy'), value: payload.inviter_name },
      { label: t('emails.teamInvite.organization'), value: place },
      { label: t('emails.teamInvite.role'), value: role },
      { label: t('emails.teamInvite.account'), value: payload.email }
    ],
    cta: {
      label: t('emails.teamInvite.cta'),
      url: `${DASHBOARD_URL}/auth/accept-invite?token=${encodeURIComponent(payload.token)}`
    },
    footnote: t('emails.teamInvite.footnote')
  };
}

/** Sends it; true only when Resend accepted the e-mail. */
export async function sendInvitationEmail(payload: InvitationPayload, fallbackLocale?: string) {
  return sendNotice(await invitationEmail(payload, fallbackLocale));
}

export interface ApprovalResult {
  status: 'approved' | 'rejected';
  email?: string;
  locale?: string | null;
  organization_name?: string | null;
  website_name?: string | null;
  website_domain?: string | null;
}

/** "Your access to <site> is ready" (approved) or the decline notice. */
export async function decisionEmail(result: ApprovalResult): Promise<NoticeInput | null> {
  if (!result.email) return null;
  const { locale, t } = await getTranslatorFor(result.locale);
  if (result.status === 'rejected') {
    return {
      to: result.email,
      locale,
      subject: t('emails.accessRejected.subject'),
      title: t('emails.accessRejected.title'),
      lines: [t('emails.accessRejected.line1'), t('emails.accessRejected.line2')]
    };
  }
  const site =
    result.website_domain || result.website_name || result.organization_name || 'LevelUp';
  return {
    to: result.email,
    locale,
    subject: t('emails.accessReady.subject', { site }),
    title: t('emails.accessReady.title', { site }),
    lines: [t('emails.accessReady.line1', { site }), t('emails.accessReady.line2')],
    details: [{ label: t('emails.accessReady.account'), value: result.email }],
    cta: {
      label: t('emails.accessReady.cta'),
      url: `${DASHBOARD_URL}/auth/sign-in?next=${encodeURIComponent('/dashboard/site')}`
    }
  };
}

export async function sendDecisionEmail(result: ApprovalResult): Promise<boolean> {
  const notice = await decisionEmail(result);
  return notice ? sendNotice(notice) : false;
}
