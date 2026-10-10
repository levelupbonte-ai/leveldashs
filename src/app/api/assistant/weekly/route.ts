import { NextResponse, type NextRequest } from 'next/server';
import { guardAssistantRequest } from '@/features/assistant/server/guard';
import { getLocale } from 'next-intl/server';
import { generateWithTarget, logAiCall } from '@/lib/ai/router';

// "This week" summary on the overview: counts only (no customer names,
// e-mails or messages ever reach the AI), turned into a short Markdown brief.

const LANGUAGE_NAMES = { en: 'English', fr: 'French' } as const;

const system = (language: string) =>
  `You are a small business owner's right hand. From this week's numbers for their website, write a summary in ${language}, in Markdown: a short bold title, 3 to 5 concrete bullet points (what changed, what needs action), then one practical recommendation for the coming week. Exact numbers, direct and kind tone, no emoji, no jargon, 110 words max. If there was no activity, say so simply and suggest one action to attract customers. Never mention AI models, providers or tools.`;

export async function POST(request: NextRequest) {
  const guard = await guardAssistantRequest(request);
  if ('error' in guard) return guard.error;
  const { db, website } = guard;

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const count = async (table: string, build: (q: any) => any) => {
    const { count: n } = await build(
      db.from(table).select('id', { count: 'exact', head: true }).eq('website_id', website.id)
    );
    return n ?? 0;
  };
  const [bookings, confirmed, cancelled, upcoming, requests, unread, reviews] = await Promise.all([
    count('appointments', (q) => q.gte('created_at', since)),
    count('appointments', (q) => q.gte('created_at', since).eq('status', 'confirmed')),
    count('appointments', (q) => q.gte('created_at', since).eq('status', 'cancelled')),
    count('appointments', (q) =>
      q.gte('appointment_date', today).in('status', ['pending', 'confirmed'])
    ),
    count('form_submissions', (q) => q.gte('created_at', since)),
    count('form_submissions', (q) => q.eq('status', 'new')),
    count('reviews', (q) => q.gte('created_at', since))
  ]);
  const facts = {
    website: website.name,
    period: 'last 7 days',
    new_appointments: bookings,
    confirmed_appointments: confirmed,
    cancelled_appointments: cancelled,
    upcoming_appointments: upcoming,
    new_requests: requests,
    unhandled_requests: unread,
    new_reviews: reviews
  };
  const locale = await getLocale();

  try {
    const { text, target } = await generateWithTarget('reports', {
      system: system(LANGUAGE_NAMES[locale]),
      prompt: JSON.stringify(facts),
      maxTokens: 450,
      temperature: 0.4
    });
    void logAiCall(db, 'reports', target);
    return NextResponse.json({ summary: text, remaining: guard.remaining });
  } catch (error) {
    console.error('weekly summary failed', error instanceof Error ? error.name : 'error');
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
