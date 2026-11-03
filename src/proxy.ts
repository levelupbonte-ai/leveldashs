import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

const CODE = /^[A-Za-z0-9_-]{8,512}$/;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const EMBED_PATH = /^\/f\/(f[a-z0-9]{10})\/embed$/;
const ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d{2,5})?$/;
const embedCache = new Map<string, { at: number; ancestors: string }>();

/**
 * frame-ancestors of an embedded form: the sites its owner allows
 * (public_form_embed_origins), read at most once a minute per form and per
 * server instance. Unknown form or any error: 'none' (never framable).
 */
async function embedAncestors(id: string): Promise<string> {
  const hit = embedCache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.ancestors;
  let ancestors = "'none'";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url && key) {
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/public_form_embed_origins`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_public_id: id }),
        signal: AbortSignal.timeout(3000)
      });
      const list = res.ok ? ((await res.json()) as unknown) : null;
      const origins = Array.isArray(list)
        ? list.filter((o): o is string => typeof o === 'string' && ORIGIN.test(o)).slice(0, 20)
        : [];
      if (origins.length) ancestors = origins.join(' ');
    } catch {
      // keep 'none'
    }
  }
  if (embedCache.size > 1000) embedCache.clear();
  embedCache.set(id, { at: Date.now(), ancestors });
  return ancestors;
}

export async function proxy(request: NextRequest) {
  // HTTPS only. Vercel already redirects; this covers Docker / other proxies that
  // forward plain-http requests (x-forwarded-proto), never local development.
  const host = request.headers.get('host') ?? '';
  if (
    process.env.NODE_ENV === 'production' &&
    request.headers.get('x-forwarded-proto') === 'http' &&
    !LOCAL_HOST.test(host)
  ) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.port = '';
    return NextResponse.redirect(url, 308);
  }

  // OAuth fallback: when Supabase cannot use the requested redirect URL it sends
  // the PKCE `code` to the Site URL (the dashboard root). Hand it to the callback,
  // which finds the destination in the lu_next cookie.
  const { pathname, searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  if (pathname === '/' && code && CODE.test(code)) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    return NextResponse.redirect(url);
  }
  // Embedded form: no session needed; only the owner's sites may frame it.
  const embed = EMBED_PATH.exec(pathname);
  if (embed) {
    const response = NextResponse.next();
    response.headers.set(
      'Content-Security-Policy',
      [
        `frame-ancestors ${await embedAncestors(embed[1])}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : [])
      ].join('; ')
    );
    return response;
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)'
  ]
};
