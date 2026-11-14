/**
 * What the team's push notifications say (no network, no database): who and
 * which page only, never a member's message.
 */

export type Env = Record<string, string | undefined>;
const KEY_RE = /^[A-Za-z0-9_-]{40,120}$/;

/** VAPID keys, or null when notifications are not set up. */
export function readVapid(env: Env) {
  const publicKey = (env.DASHBOARD_VAPID_PUBLIC_KEY ?? '').trim();
  const privateKey = (env.DASHBOARD_VAPID_PRIVATE_KEY ?? '').trim();
  return KEY_RE.test(publicKey) && KEY_RE.test(privateKey) ? { publicKey, privateKey } : null;
}

export interface StaffPushRow {
  device: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: 'en' | 'fr';
  kind: 'member' | 'message';
  website_id: string;
  website: string;
  name: string | null;
  event: number;
}

const TEXT = {
  en: {
    member: (name: string | null) => ({
      title: 'New member',
      body: name ? `${name} joined your client space.` : 'Someone joined your client space.'
    }),
    message: (name: string | null) => ({
      title: 'New message',
      body: name ? `${name} sent you a message.` : 'A member sent you a message.'
    })
  },
  fr: {
    member: (name: string | null) => ({
      title: 'Nouveau membre',
      body: name
        ? `${name} a rejoint votre espace client.`
        : 'Quelqu’un a rejoint votre espace client.'
    }),
    message: (name: string | null) => ({
      title: 'Nouveau message',
      body: name ? `${name} vous a écrit.` : 'Un membre vous a écrit.'
    })
  }
} as const;

/** What one device shows for one event. */
export function staffPushPayload(row: StaffPushRow) {
  const t = TEXT[row.locale === 'fr' ? 'fr' : 'en'][row.kind](row.name?.slice(0, 30) || null);
  return {
    title: `${t.title} · ${row.website.slice(0, 40)}`,
    body: t.body,
    url:
      row.kind === 'message'
        ? '/dashboard/site/client-portal?folder=unread'
        : '/dashboard/site/client-portal?tab=customers',
    tag: `lu-${row.kind}-${row.website_id}`
  };
}
