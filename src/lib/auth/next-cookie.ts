import { authCookieDomain } from '@/lib/supabase/cookie-domain';
import { safeNext } from './redirect';

/**
 * Safety net for the Google OAuth redirect flow. Before leaving for Google the
 * browser stores where the visitor wanted to go (a `safeNext` path or a LevelUp
 * app URL such as LevelStudio) in a short-lived cookie on the shared auth domain.
 * `/auth/callback` uses it when the `next` query parameter is missing, e.g. when
 * Supabase fell back to the Site URL and the showcase forwarded `?code=` here.
 */
export const NEXT_COOKIE = 'lu_next';
export const NEXT_COOKIE_MAX_AGE = 10 * 60;

/** Browser only: remembers the post-login destination for 10 minutes. */
export function rememberNext(next: string): void {
  if (typeof document === 'undefined') return;
  const value = encodeURIComponent(safeNext(next));
  const domain = authCookieDomain(window.location.hostname);
  const parts = [
    `${NEXT_COOKIE}=${value}`,
    'Path=/',
    `Max-Age=${NEXT_COOKIE_MAX_AGE}`,
    'SameSite=Lax',
    ...(domain ? [`Domain=${domain}`] : []),
    ...(window.location.protocol === 'https:' ? ['Secure'] : [])
  ];
  document.cookie = parts.join('; ');
}

/** Reads a cookie value written by `rememberNext` (already URL-decoded or not). */
export function readNextCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return raw.includes('%') ? decodeURIComponent(raw) : raw;
  } catch {
    return null;
  }
}

/** Options to delete the cookie on the same domain it was written to. */
export function nextCookieDeleteOptions(hostname: string) {
  const domain = authCookieDomain(hostname);
  return { path: '/', maxAge: 0, ...(domain ? { domain } : {}) };
}
