import { createHmac } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { fields } from '@/lib/validation/fields';
import { readJsonBody } from '@/lib/validation/http';

// After an editor publishes, replies or invites in *Client portal*, the browser
// calls this route so the client website sends the queued e-mails right away.
// The dashboard never sends portal e-mails itself (the website sends them with
// its own e-mail provider key): it only signs a "please send now" call to the
// website's notify URL with PORTAL_NOTIFY_SECRET (HMAC-SHA256 over
// `<timestamp>.<body>`, the same secret is set on the website's server). Without
// the secret nothing is called and the website sends the e-mails on its own
// schedule. The database checks the caller's role (portal_admin_overview).

const Body = z.strictObject({ websiteId: fields.websiteId({ required: true }) });

export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, Body, { maxBytes: 256 });
  if (!parsed.ok) return parsed.response;
  const db = await createClient();
  const { data, error } = await db.rpc('portal_admin_overview', {
    p_website_id: parsed.data.websiteId
  });
  if (error) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const secret = process.env.PORTAL_NOTIFY_SECRET;
  const target = (data as { notify_url?: string | null }).notify_url;
  if (!secret || !target || !/^https:\/\/[a-z0-9.-]+\/[\w/.-]*$/i.test(target)) {
    return NextResponse.json({ status: 'skipped' }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const body = JSON.stringify({ website_id: parsed.data.websiteId });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portal-Signature': `t=${timestamp},v1=${signature}`
      },
      body,
      signal: AbortSignal.timeout(8000),
      cache: 'no-store'
    });
    return NextResponse.json(
      { status: res.ok ? 'sent' : 'skipped' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json({ status: 'skipped' }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
