import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { fetchFeed } from '@/features/news/server/feeds';
import { summarize, type Summary } from '@/features/news/server/ai';
import { readBillingKey } from '@/lib/payments/config';
import { createAnonClient } from '@/lib/supabase/anon';

// Daily news refresh (Vercel Cron, see vercel.json). Reads the official feeds
// listed in private.news_sources, summarizes the new articles with AI (one
// call per source, never per member) and stores them. The database refuses a
// new run within 5 hours, so calling this address more often costs nothing.
// With CRON_SECRET set, only Vercel Cron (or someone holding it) can call it.
// Database calls authenticate with the LevelUp server key (LEVELUP_BILLING_KEY).

export const maxDuration = 60;

interface Source {
  id: string;
  country: string;
  name: string;
  feed_url: string;
  lang: string;
}

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

  const db = createAnonClient();
  const { data, error } = await db.rpc('news_worker_begin', { p_key: key, p_force: force });
  if (error) {
    console.error('news: begin failed', error.code ?? '');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
  const begin = data as { run: boolean; sources?: Source[]; known?: string[] };
  if (!begin.run) return NextResponse.json({ skipped: true });

  const known = new Set(begin.known ?? []);
  const since = Date.now() - 45 * 24 * 3600 * 1000;
  const report: Record<string, string> = {};

  await Promise.all(
    (begin.sources ?? []).map(async (source) => {
      const { items, status } = await fetchFeed(source.feed_url);
      const fresh = items
        .filter((it) => !known.has(it.url))
        .filter((it) => !it.publishedAt || Date.parse(it.publishedAt) > since)
        .slice(0, 8);
      let summaries = new Map<number, Summary>();
      if (fresh.length) {
        try {
          summaries = await summarize(fresh, source.name);
        } catch {
          // Saved without a summary: the title and the link still help.
        }
      }
      const payload = fresh.map((it, i) => {
        const s = summaries.get(i);
        return {
          url: it.url,
          title: it.title,
          published_at: it.publishedAt,
          summary_en: s?.summary_en || (source.lang === 'en' ? it.description.slice(0, 300) : ''),
          summary_fr: s?.summary_fr || (source.lang === 'fr' ? it.description.slice(0, 300) : ''),
          topics: s?.topics ?? [],
          important: s?.important ?? false
        };
      });
      const saved = await db.rpc('news_worker_save', {
        p_key: key,
        p_source: source.id,
        p_status: status,
        p_items: payload
      });
      report[source.id] = saved.error ? 'save_failed' : `${status}:${payload.length}`;
    })
  );
  return NextResponse.json({ ok: true, sources: report });
}
