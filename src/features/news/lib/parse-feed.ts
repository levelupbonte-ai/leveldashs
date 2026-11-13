/** Parses official RSS / Atom feeds (no dependency, https links only). */

export interface FeedItem {
  url: string;
  title: string;
  publishedAt: string | null;
  description: string;
  /** The article's image when the feed gives one (https only). */
  image: string | null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

const decodeEntities = (v: string) =>
  v
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);

/** Plain text: CDATA unwrapped, tags removed, entities decoded (also HTML escaped inside the XML). */
export function decodeText(raw: string): string {
  const once = decodeEntities(
    raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  );
  // Many feeds escape their HTML (&lt;p&gt;): after decoding, strip those tags too.
  return decodeEntities(once.replace(/<[^>]+>/g, ' '))
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
/** First image the feed gives for an item: media:content / thumbnail, an image enclosure, or an <img> in its text. */
export function feedImage(block: string): string | null {
  const raw =
    block.match(/<media:(?:content|thumbnail)[^>]*url=["']([^"']+)["']/i)?.[1] ??
    block.match(/<enclosure[^>]*type=["']image\/[^"']+["'][^>]*url=["']([^"']+)["']/i)?.[1] ??
    block.match(/<enclosure[^>]*url=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/i)?.[1] ??
    decodeEntities(block).match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ??
    null;
  return raw ? imageUrl(decodeEntities(raw)) : null;
}

/** An absolute https image address (relative ones resolved against the page), or null. */
export function imageUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw.trim(), base);
    return u.protocol === 'https:' && u.toString().length <= 800 ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The page's own share image (og:image / twitter:image) from its HTML head. */
export function pageImage(html: string, pageUrl: string): string | null {
  const head = html.slice(0, 200_000);
  const meta = (name: string) =>
    head.match(
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i')
    )?.[1] ??
    head.match(
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, 'i')
    )?.[1];
  const raw = meta('og:image') ?? meta('og:image:url') ?? meta('twitter:image');
  return raw ? imageUrl(decodeEntities(raw), pageUrl) : null;
}

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
      ).slice(0, 1200),
      image: feedImage(block)
    });
    if (out.length >= limit) break;
  }
  return out;
}
