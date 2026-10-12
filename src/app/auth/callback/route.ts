import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { NEXT_COOKIE, nextCookieDeleteOptions, readNextCookie } from '@/lib/auth/next-cookie';
import { safeNext } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';

const OTP_TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const;

// Every parameter is bounded before it reaches Supabase.
const Query = z.object({
  code: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,512}$/)
    .optional(),
  token_hash: z
    .string()
    .regex(/^(pkce_)?[A-Za-z0-9_-]{16,256}$/)
    .optional(),
  type: z.enum(OTP_TYPES).optional(),
  next: z.string().max(2048).optional()
});

// OAuth (PKCE code) and e-mail links (token_hash) both land here. A `code` may
// also arrive without `next`, forwarded by the showcase when Supabase used the
// Site URL: the PKCE verifier and the `lu_next` destination are cookies on the
// shared .levelup-ecosystem.com domain, so the exchange still works here.
export async function GET(request: NextRequest) {
  const { origin, hostname } = request.nextUrl;
  const parsed = Query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  const query = parsed.success ? parsed.data : {};
  const next = safeNext(query.next ?? readNextCookie(request.cookies.get(NEXT_COOKIE)?.value));

  // The remembered destination is single-use.
  const finish = (url: URL) => {
    const response = NextResponse.redirect(url);
    if (request.cookies.has(NEXT_COOKIE)) {
      response.cookies.set(NEXT_COOKIE, '', nextCookieDeleteOptions(hostname));
    }
    return response;
  };

  const supabase = await createClient();
  let ok = false;
  if (query.code) {
    ok = !(await supabase.auth.exchangeCodeForSession(query.code)).error;
  } else if (query.token_hash && query.type) {
    ok = !(
      await supabase.auth.verifyOtp({
        token_hash: query.token_hash,
        type: query.type as EmailOtpType
      })
    ).error;
  }

  if (!ok) return finish(new URL('/auth/sign-in?error=callback', origin));

  // Magic links, password-reset links and Google only give aal1: users with an
  // authenticator app confirm their 6-digit code first (Supabase also requires
  // aal2 to change the password of such an account).
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (await needsMfaChallenge(supabase, user)) {
    return finish(new URL(mfaChallengeUrl(next), origin));
  }

  // `next` is a same-origin path or an https URL of another LevelUp app (safeNext).
  return finish(new URL(next, origin));
}
