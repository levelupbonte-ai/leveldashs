import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

const CODE = /^[A-Za-z0-9_-]{8,512}$/;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

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
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)'
  ]
};
