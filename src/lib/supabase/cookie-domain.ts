// One LevelUp session for every app: on *.levelup-ecosystem.com the Supabase auth
// cookies are set on the parent domain, so signing in once (here) also signs the
// user in to LevelStudio and the main site. Elsewhere (localhost, Vercel previews)
// the cookies stay host-only.
export const SHARED_AUTH_DOMAIN = 'levelup-ecosystem.com';

export function authCookieDomain(hostname: string | null | undefined): string | undefined {
  const host = (hostname ?? '').split(':')[0].toLowerCase();
  return host === SHARED_AUTH_DOMAIN || host.endsWith(`.${SHARED_AUTH_DOMAIN}`)
    ? `.${SHARED_AUTH_DOMAIN}`
    : undefined;
}

export function authCookieOptions(hostname: string | null | undefined) {
  const domain = authCookieDomain(hostname);
  return domain ? { domain, path: '/', sameSite: 'lax' as const, secure: true } : undefined;
}
