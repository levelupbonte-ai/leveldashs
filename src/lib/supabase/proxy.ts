import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
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

  return response;
}
