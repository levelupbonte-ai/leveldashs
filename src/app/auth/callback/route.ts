import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { safeNext } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';

const OTP_TYPES: EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email'
];

// OAuth (PKCE code) and e-mail links (token_hash) both land here.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get('next'));
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const supabase = await createClient();

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }

  if (!ok) return NextResponse.redirect(new URL('/auth/sign-in?error=callback', origin));

  // Magic links, password-reset links and Google only give aal1: users with an
  // authenticator app confirm their 6-digit code first (Supabase also requires
  // aal2 to change the password of such an account).
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (await needsMfaChallenge(supabase, user)) {
    return NextResponse.redirect(new URL(mfaChallengeUrl(next), origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
