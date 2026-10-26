import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe webhook signature (`Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]`): HMAC-SHA256
 * of `<t>.<raw body>` with the endpoint secret, any v1 may match, timestamp within
 * the tolerance (replays refused). Pure: the secret is passed in by the server.
 * https://docs.stripe.com/webhooks#verify-manually
 */

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'expired' | 'mismatch' };

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function parseSignatureHeader(header: string | null | undefined) {
  if (!header || header.length > 2048) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, ...rest] = part.trim().split('=');
    const value = rest.join('=');
    if (key === 't' && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  return timestamp === null || signatures.length === 0 ? null : { timestamp, signatures };
}

export function signPayload(payload: string, secret: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
}

export function verifyStripeSignature(
  payload: string,
  header: string | null | undefined,
  secret: string,
  options: { now?: number; toleranceSeconds?: number } = {}
): SignatureResult {
  if (!header) return { ok: false, reason: 'missing' };
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: 'malformed' };
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const tolerance = options.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - parsed.timestamp) > tolerance) return { ok: false, reason: 'expired' };
  const expected = Buffer.from(signPayload(payload, secret, parsed.timestamp), 'hex');
  const match = parsed.signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return match ? { ok: true } : { ok: false, reason: 'mismatch' };
}
