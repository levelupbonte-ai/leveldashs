import { NextResponse, type NextRequest } from 'next/server';
import { guardAssistantRequest } from '@/features/assistant/server/guard';
import { generateWithTarget, logAiCall } from '@/lib/ai/router';

// "Résumé de la semaine" on the overview: counts only (no customer names,
// e-mails or messages ever reach the AI), turned into a short Markdown brief.

const SYSTEM = `Tu es le bras droit d’un commerçant. À partir des chiffres de la semaine de son site, écris un résumé en français, en Markdown : un titre court en gras, 3 à 5 puces concrètes (ce qui a bougé, ce qui attend une action) puis une recommandation pratique pour la semaine à venir. Chiffres exacts, ton direct et bienveillant, aucun emoji, aucun jargon, 110 mots maximum. Si l’activité est nulle, dis-le simplement et propose une action pour attirer des clients.`;

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
    site: website.name,
    periode: '7 derniers jours',
    nouveaux_rendez_vous: bookings,
    rendez_vous_confirmes: confirmed,
    rendez_vous_annules: cancelled,
    rendez_vous_a_venir: upcoming,
    nouvelles_demandes: requests,
    demandes_non_traitees: unread,
    nouveaux_avis: reviews
  };

  try {
    const { text, target } = await generateWithTarget('reports', {
      system: SYSTEM,
      prompt: JSON.stringify(facts),
      maxTokens: 450,
      temperature: 0.4
    });
    void logAiCall(db, 'reports', target);
    return NextResponse.json({ summary: text, facts, remaining: guard.remaining });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
