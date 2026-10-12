import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { ACTIVE_ORG_COOKIE } from '@/lib/auth/cookies';
import { CONTRACT_PATH, isAllowedWhileLocked } from '@/lib/auth/types';
import { LOCALE_COOKIE, localeCookieOptions, userLocale } from '@/i18n/config';
import { authCookieOptions } from './cookie-domain';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';

// Refreshes the auth cookies on every request and gates /dashboard (signed in + aal2
// when the user has a verified MFA factor).
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: authCookieOptions(request.nextUrl.hostname),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      }
    }
  });

  // getUser() validates the token with Supabase Auth (getSession() would not).
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Language saved on the account (switcher on another device): applied here when
  // this browser has no NEXT_LOCALE cookie yet, for this request and the next ones.
  const savedLocale = userLocale(user);
  if (savedLocale && !request.cookies.get(LOCALE_COOKIE)) {
    request.cookies.set(LOCALE_COOKIE, savedLocale);
    const previous = response;
    response = NextResponse.next({ request });
    previous.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    response.cookies.set(LOCALE_COOKIE, savedLocale, localeCookieOptions);
  }

  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/sign-in';
    url.search = '';
    url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Signed in with a password / magic link but the second factor (TOTP) is still
  // missing: the dashboard is only reachable once the session is aal2.
  if (
    user &&
    request.nextUrl.pathname.startsWith('/dashboard') &&
    (await needsMfaChallenge(supabase, user))
  ) {
    const url = new URL(
      mfaChallengeUrl(request.nextUrl.pathname + request.nextUrl.search),
      request.nextUrl.origin
    );
    const redirect = NextResponse.redirect(url);
    // Keep any refreshed auth cookies on the redirect.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  // Contract gate: while the active organization has a required contract to sign
  // (or blocking setup tasks), only the contract page and account settings open.
  // Checked here, on every navigation (layouts are not re-rendered on client-side
  // navigation). Staff are never locked. The database enforces the same rule on
  // content writes; if this check fails, the page stays reachable.
  if (
    user &&
    request.nextUrl.pathname.startsWith('/dashboard') &&
    !isAllowedWhileLocked(request.nextUrl.pathname)
  ) {
    const cookieOrg = request.cookies.get(ACTIVE_ORG_COOKIE)?.value ?? '';
    const { data } = await supabase.rpc('dashboard_access', {
      p_org_id: UUID.test(cookieOrg) ? cookieOrg : null
    });
    const state = (data as { state?: string } | null)?.state;
    if (state && state !== 'active') {
      const redirect = NextResponse.redirect(new URL(CONTRACT_PATH, request.nextUrl.origin));
      response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      return redirect;
    }
  }

  return response;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
