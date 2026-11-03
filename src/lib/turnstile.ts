import 'server-only';

/**
 * Cloudflare Turnstile check on the server (public LevelUp forms). Active only
 * when both keys are set: NEXT_PUBLIC_TURNSTILE_SITE_KEY (widget) and
 * TURNSTILE_SECRET_KEY (Vercel Sensitive variable, never in the browser).
 */
export function turnstileRequired(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

export async function verifyTurnstile(
  token: string | undefined,
  ip: string | null
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(8000)
    });
    const json = (await res.json().catch(() => null)) as { success?: boolean } | null;
    return json?.success === true;
  } catch {
    return false;
  }
}
