import { NextResponse } from 'next/server';
import { readBillingKey } from '@/lib/payments/config';
import { flushStaffPush } from '@/lib/push/staff';

// Sends the team's queued push notifications (new member, new message).
// Called by the client websites right after a member writes or signs in, and
// by the dashboard itself. Anyone may call it: it only sends what the database
// already queued, to the team members allowed to see it, and never twice.

export const maxDuration = 30;

async function run() {
  const key = readBillingKey(process.env);
  if (!key) return NextResponse.json({ error: 'not_configured' }, { status: 404 });
  try {
    return NextResponse.json(await flushStaffPush(key, process.env));
  } catch {
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
