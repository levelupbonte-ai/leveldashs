import { createHash } from 'node:crypto';

/**
 * SHA-256 as lower-case hex, the same value as private.sha256_hex in the
 * database (tests share the vectors). Server-side only.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Rate-limit subject for one client: the hash of its IP address (never stored
 * in clear). Vercel sets `x-forwarded-for`; the first entry is the client.
 */
export function clientFingerprint(headers: Headers): string | null {
  const ip =
    headers.get('x-real-ip')?.trim() || headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  return sha256Hex(`client:${ip.toLowerCase()}`);
}
