import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

const CODE = /^[A-Za-z0-9_-]{8,512}$/;

export async function proxy(request: NextRequest) {
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
