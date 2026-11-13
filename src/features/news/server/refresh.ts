import 'server-only';
import { createAnonClient } from '@/lib/supabase/anon';
import { summarize, type Summary } from './ai';
import { fetchFeed, fetchPageImage } from './feeds';

/**
 * One news refresh: reads the official feeds, summarizes the new articles
 * (one AI call per source), adds each article's own image, and stores them.
 * The database allows one run per 5 hours (news_worker_begin), so calling this
 * often (the daily cron, or a member opening stale news) costs nothing extra.
 */

interface Source {
  id: string;
  country: string;
  name: string;
  feed_url: string;
  lang: string;
}

export type RefreshResult =
  | { error: 'failed' }
  | { skipped: true }
  | { ok: true; sources: Record<string, string> };

export async function runNewsRefresh(key: string, force = false): Promise<RefreshResult> {
  const db = createAnonClient();
  const { data, error } = await db.rpc('news_worker_begin', { p_key: key, p_force: force });
  if (error) {
    console.error('news: begin failed', error.code ?? '');
    return { error: 'failed' };
  }
  const begin = data as { run: boolean; sources?: Source[]; known?: string[] };
  if (!begin.run) return { skipped: true };

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
      let aiFailed = false;
      if (fresh.length) {
        let countryName = source.country;
        try {
          countryName =
            new Intl.DisplayNames(['en'], { type: 'region' }).of(source.country) ?? source.country;
        } catch {
          // keep the code
        }
        try {
          summaries = await summarize(fresh, source.name, countryName);
        } catch {
          aiFailed = true;
        }
      }
      // Without the AI's summary and relevance check nothing is saved: the
      // articles are not "known" yet, so tomorrow's run tries them again.
      const kept = aiFailed
        ? []
        : fresh.flatMap((it, i) => {
            const s = summaries.get(i);
            return s ? [{ it, s }] : [];
          });
      // Each article keeps its own image: from the feed, else the page's share
      // image (only for the articles members will see).
      const payload = await Promise.all(
        kept.map(async ({ it, s }) => ({
          url: it.url,
          title: it.title,
          published_at: it.publishedAt,
          summary_en: s.summary_en,
          summary_fr: s.summary_fr,
          topics: s.topics,
          important: s.important,
          relevant: s.relevant,
          image_url: it.image ?? (s.relevant ? await fetchPageImage(it.url) : null)
        }))
      );
      const saved = await db.rpc('news_worker_save', {
        p_key: key,
        p_source: source.id,
        p_status: aiFailed ? 'ai_failed' : status,
        p_items: payload
      });
      report[source.id] = saved.error ? 'save_failed' : `${status}:${payload.length}`;
    })
  );
  return { ok: true, sources: report };
}
