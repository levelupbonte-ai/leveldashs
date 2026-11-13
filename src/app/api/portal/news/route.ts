import { NextResponse, type NextRequest } from 'next/server';
import * as z from 'zod';
import { countryGuide } from '@/features/news/server/ai';
import { readBillingKey } from '@/lib/payments/config';
import { createAnonClient } from '@/lib/supabase/anon';
import { readJsonBody } from '@/lib/validation/http';

// News for the members of a client portal, called by the client website's
// SERVER (never a browser) with `Authorization: Bearer <portal key>` and the
// member's portal session, like the assistant. The database checks both.
//
//   POST { action: 'list', session, country?, lang? }  -> the feed of a country
//   POST { action: 'guide', session, country, lang? }  -> official links of a country
//     (cached 30 days for everyone; a new country is looked up by AI, each link
//      opened before it is kept; paid members only, 5 new countries a day)

export const maxDuration = 30;

const KEY = /^lu_(live|test)_[0-9a-f]{48}$/;
const SESSION = z.string().regex(/^[0-9a-f]{64}$/);
const COUNTRY = z.string().regex(/^[A-Za-z]{2}$/);

const Body = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('list'),
    session: SESSION,
    country: COUNTRY.optional(),
    lang: z.enum(['en', 'fr']).optional()
  }),
  z.strictObject({
    action: z.literal('guide'),
    session: SESSION,
    country: COUNTRY,
    lang: z.enum(['en', 'fr']).optional()
  })
]);

const STATUS: Record<string, [number, string]> = {
  PT401: [401, 'unauthorized'],
  PT402: [402, 'membership_required'],
  PT403: [403, 'forbidden'],
  PT429: [429, 'rate_limited'],
  '22023': [400, 'invalid_request']
};

const json = (status: number, body: unknown) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const dbError = (error: { code?: string } | null) => {
  const [status, code] = STATUS[error?.code ?? ''] ?? [503, 'unavailable'];
  return json(status, { error: code });
};

export async function POST(request: NextRequest) {
  const key = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!KEY.test(key)) return json(401, { error: 'unauthorized' });
  const parsed = await readJsonBody(request, Body, { maxBytes: 4_000, allowCrossOrigin: true });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const db = createAnonClient();

  if (body.action === 'list') {
    const { data, error } = await db.rpc('portal_news', {
      p_key: key,
      p_session: body.session,
      p_country: body.country?.toUpperCase() ?? null,
      p_lang: body.lang ?? 'fr'
    });
    return error ? dbError(error) : json(200, data);
  }

  const country = body.country.toUpperCase();
  const { data, error } = await db.rpc('portal_news_guide', {
    p_key: key,
    p_session: body.session,
    p_country: country
  });
  if (error) return dbError(error);
  const found = data as { links: unknown[] | null; lookup?: boolean };
  if (found.links) return json(200, { country, links: found.links });

  let name = country;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'region' }).of(country) ?? country;
  } catch {
    // keep the code
  }
  let links: Awaited<ReturnType<typeof countryGuide>> = [];
  try {
    links = await countryGuide(country, name);
  } catch {
    return json(503, { error: 'ai_unavailable' });
  }
  const serverKey = readBillingKey(process.env);
  if (links.length && serverKey) {
    await db.rpc('news_guide_save', { p_key: serverKey, p_country: country, p_links: links });
  }
  return json(200, { country, links });
}
