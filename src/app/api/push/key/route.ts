import { NextResponse } from 'next/server';
import { readVapid } from '@/lib/push/staff';

// Public VAPID key for the browser to subscribe (null: notifications not set up).
export function GET() {
  const vapid = readVapid(process.env);
  return NextResponse.json(
    { publicKey: vapid?.publicKey ?? null },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
