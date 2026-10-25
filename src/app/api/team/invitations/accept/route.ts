import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { INVITE_TOKEN_PATTERN } from '@/lib/access/codes';
import { createClient } from '@/lib/supabase/server';
import { readJsonBody } from '@/lib/validation/http';

// The signed-in invitee accepts. The database hashes the token and checks it
// (unknown, expired, revoked, used), the confirmed e-mail and that it is the
// invited address, then creates the membership (20 attempts per hour).

const Body = z.strictObject({ token: z.string().regex(INVITE_TOKEN_PATTERN) });

type AcceptStatus =
  | 'accepted'
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'used'
  | 'email_mismatch'
  | 'email_unconfirmed';

export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, Body, { maxBytes: 256 });
  if (!parsed.ok) return parsed.response;
  const db = await createClient();
  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'sessionExpired' }, { status: 401 });
  const { data, error } = await db.rpc('accept_organization_invitation', {
    p_token: parsed.data.token
  });
  if (error) {
    console.error('accept_organization_invitation failed', error.code);
    return NextResponse.json(
      { error: error.code === 'PT429' ? 'rateLimited' : 'generic' },
      { status: error.code === 'PT429' ? 429 : 400 }
    );
  }
  const result = data as {
    status: AcceptStatus;
    organization_id?: string;
    organization_name?: string;
  };
  return NextResponse.json(
    {
      status: result.status,
      organizationId: result.organization_id ?? null,
      organizationName: result.organization_name ?? null
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
