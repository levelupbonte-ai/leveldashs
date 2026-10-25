import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { clientFingerprint } from '@/lib/access/hash';
import { createClient } from '@/lib/supabase/server';
import { readJsonBody } from '@/lib/validation/http';

// "I have an activation code": the signed-in account (confirmed e-mail) redeems
// a one-time code LevelUp staff sent. The database hashes and checks it and
// limits attempts (5 per hour, 20 per day) per account and per client; the
// client is the hash of the IP address, never the address itself. Unknown,
// used, revoked or wrongly bound codes all get the same answer.
// The website id alone never grants anything: it is public.

const Body = z.strictObject({ code: z.string().min(1).max(64) });

export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, Body, { maxBytes: 256 });
  if (!parsed.ok) return parsed.response;
  const db = await createClient();
  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'sessionExpired' }, { status: 401 });
  const { data, error } = await db.rpc('redeem_activation_code', {
    p_code: parsed.data.code,
    p_client: clientFingerprint(request.headers)
  });
  if (error) {
    console.error('redeem_activation_code failed', error.code);
    return NextResponse.json(
      { error: error.code === 'PT429' ? 'rateLimited' : 'generic' },
      { status: error.code === 'PT429' ? 429 : 400 }
    );
  }
  const result = data as {
    status: 'activated' | 'already_member' | 'expired' | 'invalid' | 'email_unconfirmed';
    website_id?: string;
    website_name?: string;
    organization_id?: string;
  };
  return NextResponse.json(
    {
      status: result.status,
      websiteId: result.website_id ?? null,
      websiteName: result.website_name ?? null,
      organizationId: result.organization_id ?? null
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
