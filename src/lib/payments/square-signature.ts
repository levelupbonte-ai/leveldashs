import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Square webhook signature (`x-square-hmacsha256-signature`): base64 of the
 * HMAC-SHA256 of `<notification URL><raw body>` (no separator) with the
 * subscription's signature key. The URL is exactly the one registered on the
 * subscription. Compared in constant time. Pure: the key is passed in by the server.
 * https://developer.squareup.com/docs/webhooks/step3validate
 */

export type SquareSignatureResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'mismatch' };

const BASE64 = /^[A-Za-z0-9+/]{43}=$/;

export function signSquarePayload(notificationUrl: string, body: string, key: string): string {
  return createHmac('sha256', key)
    .update(notificationUrl + body, 'utf8')
    .digest('base64');
}

export function verifySquareSignature(
  body: string,
  header: string | null | undefined,
  key: string,
  notificationUrl: string
): SquareSignatureResult {
  if (!header) return { ok: false, reason: 'missing' };
  const given = header.trim();
  if (!BASE64.test(given)) return { ok: false, reason: 'malformed' };
  const expected = Buffer.from(signSquarePayload(notificationUrl, body, key), 'base64');
  const actual = Buffer.from(given, 'base64');
  const match = actual.length === expected.length && timingSafeEqual(actual, expected);
  return match ? { ok: true } : { ok: false, reason: 'mismatch' };
}
