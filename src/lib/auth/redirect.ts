/** LevelUp apps a sign-in may return to (exact hosts, never a wildcard). */
const ALLOWED_HOSTS = new Set([
  'levelup-ecosystem.com',
  'www.levelup-ecosystem.com',
  'dashboard.levelup-ecosystem.com',
  'studio.levelup-ecosystem.com'
]);

const PROBE_ORIGIN = 'https://next.invalid';

/**
 * Post-login destination: a same-origin path, or an https URL on one of the
 * LevelUp apps above, so the dashboard sign-in can serve every LevelUp app.
 * Paths are parsed the way browsers do (tabs/newlines stripped, backslashes
 * read as slashes) and must stay on this origin; anything else falls back.
 */
export function safeNext(next: string | null | undefined, fallback = '/dashboard/site'): string {
  if (!next || next.length > 2048) return fallback;
  if (next.startsWith('/')) {
    try {
      const url = new URL(next, PROBE_ORIGIN);
      if (url.origin !== PROBE_ORIGIN) return fallback;
      return url.pathname + url.search + url.hash;
    } catch {
      return fallback;
    }
  }
  try {
    const url = new URL(next);
    const ok =
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ALLOWED_HOSTS.has(url.hostname.toLowerCase());
    return ok ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export const isExternalNext = (next: string) => next.startsWith('https://');
