import { NextResponse, type NextRequest } from 'next/server';
import { DEMO_CODE, DEMO_TOKEN, demoTrackingUrl } from '@/lib/demo/links';

// The paid human demo (19 USD) is no longer sold (see docs/offer.md). Old
// "Pay and send my project" links bring the visitor back to their tracking
// page, where the request is shown as received by the team. Demos already paid
// keep their tracking and steps; their payments were recorded by the webhook.

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const code = params.get('c') ?? '';
  const token = params.get('k') ?? '';
  if (!DEMO_CODE.test(code) || !DEMO_TOKEN.test(token)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.redirect(demoTrackingUrl(code, token), 303);
}
