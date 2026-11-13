import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { runNewsRefresh } from '@/features/news/server/refresh';
import { readBillingKey } from '@/lib/payments/config';

// Daily news refresh (Vercel Cron, see vercel.json). Reads the official feeds
// listed in private.news_sources, summarizes the new articles with AI (one
// call per source, never per member) and stores them. The database refuses a
// new run within 5 hours, so calling this address more often costs nothing.
// With CRON_SECRET set, only Vercel Cron (or someone holding it) can call it.
// Database calls authenticate with the LevelUp server key (LEVELUP_BILLING_KEY).

export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return true;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: NextRequest) {
  const key = readBillingKey(process.env);
  if (!key) return NextResponse.json({ error: 'not_configured' }, { status: 404 });
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const force =
    Boolean(process.env.CRON_SECRET) && new URL(request.url).searchParams.get('force') === '1';

  const result = await runNewsRefresh(key, force);
  return 'error' in result ? NextResponse.json(result, { status: 500 }) : NextResponse.json(result);
}
