/** Parses official RSS / Atom feeds (no dependency, https links only). */

export interface FeedItem {
  url: string;
  title: string;
  publishedAt: string | null;
  description: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

export function decodeText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

const tag = (block: string, name: string) =>
  block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1] ?? '';

function cleanUrl(raw: string): string | null {
  const v = decodeText(raw);
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && v.length <= 800 ? u.toString() : null;
  } catch {
    return null;
  }
}

function isoDate(raw: string): string | null {
  const v = decodeText(raw);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** RSS <item> and Atom <entry> blocks, newest first as published. */
export function parseFeed(xml: string, limit = 10): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    const atomLink =
      block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ??
      block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1];
    const url = cleanUrl(tag(block, 'link') || atomLink || tag(block, 'guid'));
    const title = decodeText(tag(block, 'title')).slice(0, 300);
    if (!url || title.length < 3) continue;
    out.push({
      url,
      title,
      publishedAt: isoDate(
        tag(block, 'pubDate') ||
          tag(block, 'published') ||
          tag(block, 'updated') ||
          tag(block, 'dc:date')
      ),
      description: decodeText(
        tag(block, 'description') || tag(block, 'summary') || tag(block, 'content')
      ).slice(0, 1200)
    });
    if (out.length >= limit) break;
  }
  return out;
}
