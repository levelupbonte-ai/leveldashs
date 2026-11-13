import 'server-only';
import { generateText } from '@/lib/ai/router';
import type { FeedItem } from './feeds';

/**
 * The AI part of the news, kept cheap: one call per source per day for the
 * new articles (never per member), and one call per country for its official
 * links, cached 30 days for everyone.
 */

export interface Summary {
  summary_en: string;
  summary_fr: string;
  topics: string[];
  important: boolean;
  /** Useful to someone preparing to visit, study, work or settle in the country. */
  relevant: boolean;
}

const TOPICS = ['visa', 'study', 'work', 'travel', 'family', 'fees', 'residence', 'other'];

function parseJsonArray(text: string): unknown[] | null {
  const raw = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  for (const candidate of [raw, raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)]) {
    try {
      const v = JSON.parse(candidate);
      if (Array.isArray(v)) return v;
    } catch {
      // next candidate
    }
  }
  return null;
}

const clip = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Short summaries in English and French, topics, "important" and "relevant" flags. */
export async function summarize(
  items: FeedItem[],
  sourceName: string,
  countryName: string
): Promise<Map<number, Summary>> {
  const out = new Map<number, Summary>();
  if (!items.length) return out;
  const list = items
    .map((it, i) => `[${i}] TITLE: ${it.title}\nTEXT: ${it.description.slice(0, 700) || '(none)'}`)
    .join('\n\n');
  const text = await generateText('reports', {
    system:
      'You summarize official government news for people preparing to travel, study, work or settle abroad. ' +
      'Use ONLY the facts in the given title and text; never add dates, numbers or rules that are not written there. ' +
      'Answer with a JSON array only.',
    prompt:
      `SOURCE: ${sourceName} (official, ${countryName})\nREADERS: people from abroad (mostly Africa) preparing to visit, study, work or settle in ${countryName}.\n\nARTICLES:\n${list}\n\n` +
      'For each article return {"i": index, "summary_en": "1-2 short sentences: what changes and for whom", ' +
      '"summary_fr": "the same in natural French", "topics": subset of ' +
      JSON.stringify(TOPICS) +
      ', "important": true only when it changes rules, fees, deadlines, processing or entry conditions, ' +
      '"relevant": true only if these readers need it for their visa, permit, studies, work, family or arrival ' +
      "(false for budgets, politics, diplomacy, court cases, ministers' agendas or news for the country's own citizens)}. JSON array only.",
    maxTokens: 1800,
    temperature: 0.2
  });
  for (const row of parseJsonArray(text) ?? []) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const i = Number(r.i);
    if (!Number.isInteger(i) || i < 0 || i >= items.length) continue;
    out.set(i, {
      summary_en: clip(r.summary_en, 600),
      summary_fr: clip(r.summary_fr, 600),
      topics: Array.isArray(r.topics)
        ? r.topics.filter((t): t is string => TOPICS.includes(String(t)))
        : [],
      important: r.important === true,
      relevant: r.relevant === true
    });
  }
  return out;
}

export interface GuideLink {
  name: string;
  url: string;
  kind: string;
}

// Official-looking hosts only (governments, embassies, public agencies).
const OFFICIAL_HOST =
  /(^|\.)(gov|gouv|gob|go|govt|government|gc|admin|bund|state|int|europa)\.|\.(gov|gouv|gob|int|mil)(\.[a-z]{2})?$|embass|ambassad|consul|diplomat|immigra|visa|canada\.ca$|europa\.eu$|campusfrance\.org$/i;

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'LevelUpNews/1.0 (+https://levelup-ecosystem.com)' },
      cache: 'no-store'
    });
    await res.body?.cancel().catch(() => undefined);
    return res.status < 400;
  } catch {
    return false;
  }
}

/**
 * Official websites for a destination country (immigration, visas, studies,
 * travel advice). Every link is opened before it is kept: an address the AI
 * got wrong, or a site that is not official-looking, is dropped.
 */
export async function countryGuide(country: string, countryName: string): Promise<GuideLink[]> {
  const text = await generateText('reports', {
    system:
      'You list OFFICIAL government websites only (ministries, immigration agencies, embassies, public study agencies). ' +
      'Never list private agencies, blogs, news sites or forms sellers. If you are not sure of an exact address, leave it out. JSON array only.',
    prompt:
      `Country: ${countryName} (${country}). List up to 6 official websites a foreigner needs to prepare a stay there: ` +
      'visas and entry, immigration / residence, studying there, and official travel information. ' +
      'Return [{"name": "official name", "url": "https://... exact homepage or section", "kind": "visa|immigration|study|travel"}].',
    maxTokens: 700,
    temperature: 0
  });
  const candidates: GuideLink[] = [];
  for (const row of parseJsonArray(text) ?? []) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = clip(r.name, 120);
    const kind = ['visa', 'immigration', 'study', 'travel'].includes(String(r.kind))
      ? String(r.kind)
      : 'visa';
    try {
      const u = new URL(String(r.url ?? ''));
      if (u.protocol !== 'https:' || !OFFICIAL_HOST.test(u.hostname) || !name) continue;
      if (candidates.some((c) => new URL(c.url).hostname === u.hostname && c.kind === kind))
        continue;
      candidates.push({ name, url: u.toString().slice(0, 500), kind });
    } catch {
      // not a URL
    }
    if (candidates.length >= 8) break;
  }
  const checked = await Promise.all(
    candidates.map(async (c) => ((await reachable(c.url)) ? c : null))
  );
  return checked.filter((c): c is GuideLink => c !== null).slice(0, 6);
}
