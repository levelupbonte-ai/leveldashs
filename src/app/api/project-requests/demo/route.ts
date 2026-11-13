import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sendDemoStatusEmail, type DemoStep } from '@/lib/demo/emails';
import { createClient } from '@/lib/supabase/server';
import { readJsonBody } from '@/lib/validation/http';

// LevelUp moves a paid human demo to its next step (Project requests). The
// database checks the role (owner/admin of the LevelUp website), MFA, the status
// and the link; the client is then e-mailed the new step with their tracking link.

const Body = z.strictObject({
  websiteId: z.string().regex(/^ws_[0-9a-f]{16}$/),
  id: z.uuid(),
  status: z.enum(['paid', 'analysis', 'design', 'build', 'final_check', 'ready', 'cancelled']),
  message: z.string().max(600).optional(),
  demoUrl: z.string().max(500).optional(),
  readyBy: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notify: z.boolean()
});

const CODES: Record<string, string> = {
  demo_not_paid: 'demoNotPaid',
  demo_url_required: 'demoUrlRequired',
  invalid_dates: 'invalidValues',
  'Invalid status': 'invalidValues'
};

export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, Body, { maxBytes: 4 * 1024 });
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;
  const db = await createClient();
  const { data, error } = await db.rpc('site_demo_update', {
    p_website_id: b.websiteId,
    p_id: b.id,
    p_status: b.status,
    p_message: b.message?.trim() || null,
    p_demo_url: b.demoUrl?.trim() || null,
    p_ready_by: b.readyBy ?? null
  });
  if (error) {
    const code =
      CODES[error.message] ??
      (error.code === '42501'
        ? 'forbidden'
        : error.code === 'PT404'
          ? 'notFound'
          : error.message?.includes('aal2') || error.code === 'PT401'
            ? 'mfaRequired'
            : error.code === '22023'
              ? 'invalidValues'
              : 'saveFailed');
    if (code === 'saveFailed') console.error('site_demo_update failed', error.code ?? '');
    return NextResponse.json({ error: code }, { status: code === 'forbidden' ? 403 : 400 });
  }
  const emailed = b.notify ? await sendDemoStatusEmail(data as DemoStep) : false;
  return NextResponse.json({ ok: true, emailed }, { headers: { 'Cache-Control': 'no-store' } });
}
