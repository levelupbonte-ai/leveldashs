import { NextResponse, type NextRequest } from 'next/server';
import { UUID } from '@/features/email-campaigns/server/http';
import { createAnonClient } from '@/lib/supabase/anon';
import { errorResponse } from '@/lib/validation/http';

// One-click unsubscribe (RFC 8058): mail apps POST `List-Unsubscribe=One-Click`
// here from the List-Unsubscribe header, without any page. The unsubscribe page
// posts its form here too and is sent back to the confirmation. The token only
// reaches its own contact; a second use changes nothing. GET (a link scanner, a
// pasted URL) never unsubscribes: it shows the page with its button.

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function pageUrl(request: NextRequest, token: string, campaign: string | null, done: boolean) {
  const url = new URL(`/unsubscribe/${encodeURIComponent(token)}`, request.nextUrl.origin);
  if (campaign) url.searchParams.set('c', campaign);
  if (done) url.searchParams.set('done', '1');
  return url;
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const c = request.nextUrl.searchParams.get('c');
  return NextResponse.redirect(pageUrl(request, token, c && UUID.test(c) ? c : null, false), 303);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const c = request.nextUrl.searchParams.get('c');
  const campaign = c && UUID.test(c) ? c : null;
  const fromPage = (await request.text().catch(() => '')).slice(0, 200).includes('from=page');
  // The test e-mail's link does nothing.
  if (token === 'test') {
    return fromPage
      ? NextResponse.redirect(pageUrl(request, token, null, true), 303)
      : new NextResponse(null, { status: 200 });
  }
  if (!TOKEN.test(token)) return errorResponse(404, 'not_found');
  const { data, error } = await createAnonClient().rpc('email_unsubscribe', {
    p_token: token,
    p_campaign_id: campaign
  });
  if (error) {
    console.error('unsubscribe failed', error.code ?? '');
    return errorResponse(500, 'failed');
  }
  const status = (data as { status?: string } | null)?.status;
  if (status === 'invalid') return errorResponse(404, 'not_found');
  if (fromPage) return NextResponse.redirect(pageUrl(request, token, campaign, true), 303);
  return NextResponse.json({ status }, { headers: { 'Cache-Control': 'no-store' } });
}
