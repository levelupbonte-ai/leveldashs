import 'server-only';
import { getTranslatorFor } from '@/i18n/messages';
import { DASHBOARD_URL } from '@/lib/email/access-emails';
import { sendNotice, TEAM_INBOX } from '@/lib/email/notice';
import { demoTrackingUrl } from './links';

// E-mails of the paid human demo: to the client (payment received, each new
// step) and to the LevelUp team (a new paid demo). Never throw.

const STATUSES = [
  'awaiting_payment',
  'paid',
  'analysis',
  'design',
  'build',
  'final_check',
  'ready',
  'cancelled'
] as const;
type DemoStatus = (typeof STATUSES)[number];
const isStatus = (v: unknown): v is DemoStatus => STATUSES.includes(v as DemoStatus);

const firstName = (name: string) => name.trim().split(/\s+/)[0]?.slice(0, 40) ?? '';

function formatDate(date: string | null | undefined, locale: string) {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-US', { dateStyle: 'long' });
}

export interface DemoPaid {
  code: string;
  token: string;
  email: string;
  name: string;
  locale: string;
  business_name: string | null;
  project_type: string | null;
  ready_by: string | null;
  estimate_min_days: number | null;
  estimate_max_days: number | null;
}

export async function sendDemoPaidEmails(demo: DemoPaid, amount: string) {
  const min = demo.estimate_min_days ?? 3;
  const max = Math.max(demo.estimate_max_days ?? min, min);
  const business = demo.business_name || demo.code;
  const client = await getTranslatorFor(demo.locale);
  const date = formatDate(demo.ready_by, client.locale);
  const toClient = sendNotice({
    to: demo.email,
    locale: client.locale,
    subject: client.t('emails.demoPaid.subject', { code: demo.code }),
    title: client.t('emails.demoPaid.title'),
    lines: [
      client.t('emails.demoPaid.hello', { name: firstName(demo.name) }),
      client.t('emails.demoPaid.line1', { amount, business }),
      client.t('emails.demoPaid.line2', { min, max, date }),
      client.t('emails.demoPaid.line3', { code: demo.code })
    ],
    cta: { label: client.t('emails.demoPaid.cta'), url: demoTrackingUrl(demo.code, demo.token) },
    footnote: client.t('emails.demoPaid.footnote')
  }).catch(() => false);
  // Internal notice: always in English, the ecosystem's official language.
  const team = await getTranslatorFor('en');
  const toTeam = sendNotice({
    to: TEAM_INBOX,
    locale: 'en',
    subject: team.t('emails.demoPaidTeam.subject', { code: demo.code, business }),
    title: team.t('emails.demoPaidTeam.title'),
    lines: [
      team.t('emails.demoPaidTeam.business', { value: business }),
      team.t('emails.demoPaidTeam.type', { value: demo.project_type || '—' }),
      team.t('emails.demoPaidTeam.contact', { value: `${demo.name} <${demo.email}>` }),
      team.t('emails.demoPaidTeam.estimate', { min, max, date: formatDate(demo.ready_by, 'en') })
    ],
    cta: {
      label: team.t('emails.demoPaidTeam.cta'),
      url: `${DASHBOARD_URL}/dashboard/site/project-requests`
    }
  }).catch(() => false);
  await Promise.all([toClient, toTeam]);
}

export interface DemoStep {
  code: string;
  token: string;
  email: string;
  name: string;
  locale: string;
  business_name: string | null;
  status: string;
  message: string | null;
  ready_by: string | null;
}

export async function sendDemoStatusEmail(demo: DemoStep) {
  if (!isStatus(demo.status)) return false;
  const { t, locale } = await getTranslatorFor(demo.locale);
  const status = t(`emails.demoStatuses.${demo.status}`);
  const date = formatDate(demo.ready_by, locale);
  return sendNotice({
    to: demo.email,
    locale,
    subject: t('emails.demoStatus.subject', { code: demo.code, status }),
    title: t('emails.demoStatus.title'),
    lines: [
      t('emails.demoStatus.hello', { name: firstName(demo.name) }),
      t('emails.demoStatus.line', { business: demo.business_name || demo.code, status }),
      ...(demo.message ? [t('emails.demoStatus.message', { value: demo.message })] : []),
      ...(demo.status === 'ready' ? [t('emails.demoStatus.ready')] : []),
      ...(date && demo.status !== 'ready' && demo.status !== 'cancelled'
        ? [t('emails.demoStatus.date', { date })]
        : [])
    ],
    cta: { label: t('emails.demoStatus.cta'), url: demoTrackingUrl(demo.code, demo.token) }
  }).catch(() => false);
}
