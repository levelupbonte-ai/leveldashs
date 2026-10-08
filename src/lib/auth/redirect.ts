import { SHARED_AUTH_DOMAIN } from '@/lib/supabase/cookie-domain';

/**
 * Post-login destination: a same-origin relative path, or an https URL on a
 * LevelUp app (levelup-ecosystem.com and its subdomains), so the dashboard
 * sign-in can serve as the single login page of every LevelUp app.
 * Anything else falls back, which blocks open redirects.
 */
export function safeNext(next: string | null | undefined, fallback = '/dashboard/site'): string {
  if (!next) return fallback;
  if (next.startsWith('/')) {
    return next.startsWith('//') || next.startsWith('/\\') ? fallback : next;
  }
  try {
    const url = new URL(next);
    const host = url.hostname.toLowerCase();
    const allowed =
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (host === SHARED_AUTH_DOMAIN || host.endsWith(`.${SHARED_AUTH_DOMAIN}`));
    return allowed ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export const isExternalNext = (next: string) => next.startsWith('https://');
