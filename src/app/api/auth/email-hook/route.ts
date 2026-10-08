import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/auth/redirect';
import { buildAuthEmail, isSupportedAuthEmail } from '@/lib/email/auth-emails';

// Supabase Auth "Send Email Hook": Supabase calls this endpoint instead of
// sending its own e-mails, and we send LevelUp-branded ones through Resend.
// Every call is signed (Standard Webhooks) with SEND_EMAIL_HOOK_SECRET; any
// request without a valid, fresh signature is rejected before reading it.

const HOOK_SECRET = process.env.SEND_EMAIL_HOOK_SECRET ?? '';
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const FROM = process.env.AUTH_EMAIL_FROM || 'LevelUp Ecosystem <account@levelup-ecosystem.com>';
const APP_URL = 'https://dashboard.levelup-ecosystem.com';
const TOLERANCE_SECONDS = 5 * 60;

type HookPayload = {
  user: { email?: string; new_email?: string };
  email_data: {
    token?: string;
    token_hash?: string;
    token_new?: string;
    token_hash_new?: string;
    redirect_to?: string;
    email_action_type?: string;
  };
};

function verify(request: NextRequest, body: string): boolean {
  const id = request.headers.get('webhook-id');
  const timestamp = request.headers.get('webhook-timestamp');
  const signatures = request.headers.get('webhook-signature');
  const secret = HOOK_SECRET.replace(/^v1,whsec_/, '');
  if (!id || !timestamp || !signatures || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest();
  return signatures.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Post-verification destination: the `next` of our own callback, else a LevelUp URL. */
function destination(redirectTo: string | undefined): string {
  if (!redirectTo) return '/dashboard/site';
  try {
    const url = new URL(redirectTo);
    if (url.origin === APP_URL && url.pathname === '/auth/callback') {
      return safeNext(url.searchParams.get('next'));
    }
  } catch {
    return '/dashboard/site';
  }
  return safeNext(redirectTo);
}

/**
 * Sign-up links always land on the "e-mail verified" page, which tells people to
 * return to the device where they started (that tab moves on by itself) or to
 * continue on this one (`next`).
 */
function verifiedPage(next: string): string {
  if (next.startsWith('/auth/verified')) return next;
  return `/auth/verified?next=${encodeURIComponent(next)}`;
}

// verifyOtp types: sign-up and magic-link tokens are both verified as 'email'.
const VERIFY_TYPE: Record<string, string> = {
  signup: 'email',
  magiclink: 'email',
  recovery: 'recovery',
  invite: 'invite',
  email_change: 'email_change'
};

function link(type: string, tokenHash: string | undefined, next: string): string | undefined {
  const verifyType = VERIFY_TYPE[type];
  // PKCE flows (the dashboard's) send hashes prefixed with "pkce_".
  if (!verifyType || !tokenHash || !/^(pkce_)?[A-Za-z0-9_-]{16,256}$/.test(tokenHash))
    return undefined;
  const url = new URL('/auth/callback', APP_URL);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', verifyType);
  url.searchParams.set('next', next);
  return url.toString();
}

// E-mails whose whole point is the button: never send them without it.
const NEEDS_LINK = new Set(['signup', 'magiclink', 'recovery', 'invite', 'email_change']);

async function send(to: string, type: string, opts: { link?: string; code?: string }) {
  if (NEEDS_LINK.has(type) && !opts.link) throw new Error('missing_link');
  const { subject, html } = buildAuthEmail(type, opts);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`resend_${res.status}`);
}

const hookError = (status: number, message: string) =>
  NextResponse.json({ error: { http_code: status, message } }, { status });

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (body.length > 64_000 || !verify(request, body)) return hookError(401, 'invalid signature');
  if (!RESEND_API_KEY) return hookError(500, 'email provider not configured');

  let payload: HookPayload;
  try {
    payload = JSON.parse(body) as HookPayload;
  } catch {
    return hookError(400, 'invalid payload');
  }
  const { user, email_data: data } = payload;
  const type = data?.email_action_type ?? '';
  if (!user?.email || !isSupportedAuthEmail(type)) {
    // Notifications we do not customise are simply not sent.
    return NextResponse.json({});
  }

  const next =
    type === 'recovery'
      ? '/auth/reset-password'
      : type === 'signup'
        ? verifiedPage(destination(data.redirect_to))
        : destination(data.redirect_to);
  try {
    if (type === 'email_change') {
      // Field names are reversed upstream: token_hash_new goes to the current
      // address, token_hash to the new one (Secure Email Change sends both).
      if (data.token_hash_new && user.new_email) {
        await send(user.email, type, {
          link: link(type, data.token_hash_new, next)
        });
        await send(user.new_email, type, {
          link: link(type, data.token_hash, next)
        });
      } else {
        await send(user.new_email ?? user.email, type, {
          link: link(type, data.token_hash, next)
        });
      }
    } else {
      await send(user.email, type, {
        link: link(type, data.token_hash, next),
        code: type === 'reauthentication' ? data.token : undefined
      });
    }
  } catch {
    return hookError(502, 'email could not be sent');
  }
  return NextResponse.json({});
}
