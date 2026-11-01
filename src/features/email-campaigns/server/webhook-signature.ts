import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signature of the e-mail provider's webhooks (Svix format): headers
 * `svix-id`, `svix-timestamp` (unix seconds) and `svix-signature`
 * (`v1,<base64>` entries separated by spaces). The signed content is
 * `<id>.<timestamp>.<raw body>`, HMAC-SHA256 with the base64 part of the
 * `whsec_…` secret. Timestamp within 5 minutes (replays refused). Pure: the
 * secret is passed in by the server.
 */

export type WebhookCheck =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'expired' | 'mismatch' | 'secret' };

export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function webhookSecretBytes(secret: string): Buffer | null {
  const m = /^whsec_([A-Za-z0-9+/=]{16,200})$/.exec(secret.trim());
  if (!m) return null;
  const bytes = Buffer.from(m[1]!, 'base64');
  return bytes.length >= 16 ? bytes : null;
}

export function signWebhook(id: string, timestamp: number, body: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`, 'utf8').digest('base64');
}

export function verifyWebhook(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  now = Date.now()
): WebhookCheck {
  const key = webhookSecretBytes(secret);
  if (!key) return { ok: false, reason: 'secret' };
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing' };
  if (
    !/^[A-Za-z0-9_.:-]{1,100}$/.test(id) ||
    !/^\d{1,12}$/.test(timestamp) ||
    signature.length > 2048
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'expired' };
  }
  const expected = Buffer.from(signWebhook(id, Number(timestamp), body, key), 'base64');
  const match = signature.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return match ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/** The provider event, reduced to what the database records. Null for anything else. */
export function toEmailEvent(id: string, event: unknown) {
  if (!event || typeof event !== 'object') return null;
  const e = event as { type?: unknown; created_at?: unknown; data?: Record<string, unknown> };
  const type =
    e.type === 'email.delivered'
      ? 'delivered'
      : e.type === 'email.bounced'
        ? 'bounced'
        : e.type === 'email.complained'
          ? 'complained'
          : e.type === 'email.delivery_delayed'
            ? 'delivery_delayed'
            : null;
  const emailId = e.data?.email_id;
  if (!type || typeof emailId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(emailId)) return null;
  const bounce = e.data?.bounce as { type?: unknown } | undefined;
  const created = typeof e.created_at === 'string' ? e.created_at : (e.data?.created_at as unknown);
  return {
    id,
    type,
    email_id: emailId,
    created_at: typeof created === 'string' && !Number.isNaN(Date.parse(created)) ? created : null,
    bounce_type: typeof bounce?.type === 'string' ? bounce.type.slice(0, 40) : null
  };
}
