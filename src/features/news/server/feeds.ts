import 'server-only';

/**
 * Reads an official RSS or Atom feed. Small and strict on purpose: only https
 * links, plain-text titles and short descriptions, at most `limit` items, and
 * a few seconds per feed. A feed that fails says why in a short status.
 */

import { pageImage, parseFeed, type FeedItem } from '../lib/parse-feed';

export type { FeedItem };

export async function fetchFeed(
  url: string,
  timeoutMs = 9000
): Promise<{ items: FeedItem[]; status: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept:
          'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
        'User-Agent': 'LevelUpNews/1.0 (+https://levelup-ecosystem.com)'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store'
    });
    if (!res.ok) return { items: [], status: `http_${res.status}` };
    const xml = (await res.text()).slice(0, 2_000_000);
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) return { items: [], status: 'not_a_feed' };
    const items = parseFeed(xml);
    return { items, status: items.length ? 'ok' : 'empty' };
  } catch (err) {
    return {
      items: [],
      status: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'unreachable'
    };
  }
}

/** The article page's share image (og:image), read from the start of its HTML. */
export async function fetchPageImage(url: string, timeoutMs = 5000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'LevelUpNews/1.0 (+https://levelup-ecosystem.com)'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store'
    });
    if (!res.ok || !res.body) return null;
    // The head is enough: read at most ~300 KB.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    while (html.length < 300_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    await reader.cancel().catch(() => undefined);
    return pageImage(html, res.url || url);
  } catch {
    return null;
  }
}
