import { NextResponse, type NextRequest } from 'next/server';
import * as z from 'zod';
import { clientFingerprint } from '@/lib/access/hash';
import { createClient } from '@/lib/supabase/server';
import { turnstileRequired, verifyTurnstile } from '@/lib/turnstile';
import { readJsonBody } from '@/lib/validation/http';

// Answers to a LevelUp hosted form (/f/[id]). The browser sends the values; the
// database checks every one against the stored form (public_form_submit).
// Same origin only, 48 KB at most, a hidden honeypot field, the anti-robot
// check when configured, and per-sender limits from the hashed IP.

const ORIGINS = [
  'https://dashboard.levelup-ecosystem.com',
  ...(process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:3000', 'http://localhost:3123'])
];

const Body = z.strictObject({
  values: z.record(z.string().max(40), z.unknown()),
  consent: z.boolean().optional(),
  /** Honeypot: people never see it, robots fill it. */
  website: z.string().max(200).optional(),
  turnstile: z.string().max(2048).optional(),
  /** Milliseconds the page was open before sending (robots send at once). */
  elapsed: z.number().int().min(0).max(86_400_000).optional()
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^f[a-z0-9]{10}$/.test(id))
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = await readJsonBody(request, Body, {
    maxBytes: 48 * 1024,
    allowedOrigins: ORIGINS
  });
  if (!parsed.ok) return parsed.response;
  const { values, consent, website, turnstile, elapsed } = parsed.data;

  // A robot: answer like a success so it learns nothing, store nothing.
  if (website || (elapsed !== undefined && elapsed < 1500)) {
    return NextResponse.json({ ok: true });
  }
  const ip =
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    null;
  if (turnstileRequired() && !(await verifyTurnstile(turnstile, ip))) {
    return NextResponse.json({ error: 'captcha' }, { status: 403 });
  }

  const db = await createClient();
  const { data, error } = await db.rpc('public_form_submit', {
    p_public_id: id,
    p_values: { ...values, ...(consent ? { _consent: true } : {}) },
    p_subject: clientFingerprint(request.headers)
  });
  if (error) {
    if (error.code === 'PT404') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (error.code === 'PT429') return NextResponse.json({ error: 'limit' }, { status: 429 });
    if (error.code === '22023' || error.code === '23514') {
      // Which field was refused (an id from the form itself), never the database message.
      const field =
        typeof error.hint === 'string' && /^[a-z_][a-z0-9_]{0,39}$/.test(error.hint)
          ? error.hint
          : undefined;
      return NextResponse.json({ error: 'invalid', field }, { status: 422 });
    }
    console.error('public form failed', error.code);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    ticket: (data as { ticket_code?: string } | null)?.ticket_code
  });
}
