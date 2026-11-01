import { NextResponse, type NextRequest } from 'next/server';
import { toEmailEvent, verifyWebhook } from '@/features/email-campaigns/server/webhook-signature';
import { createAnonClient } from '@/lib/supabase/anon';
import { errorResponse } from '@/lib/validation/http';

// Delivery events of campaign e-mails from the e-mail provider: delivered,
// bounced (hard bounces mark the contact bounced), complained (the contact is
// marked complained). Off (404) until RESEND_WEBHOOK_SECRET and
// LEVELUP_EMAIL_KEY are set. The signature is checked on the raw body; the
// database call authenticates with the e-mail worker key. Duplicates are
// ignored by event id. 2xx once recorded or ignored, 5xx to be retried.

const MAX_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const key = process.env.LEVELUP_EMAIL_KEY;
  if (!secret || !key) return errorResponse(404, 'not_found');

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES)
    return errorResponse(413, 'too_large');
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return errorResponse(413, 'too_large');

  const id = request.headers.get('svix-id');
  const check = verifyWebhook(
    raw,
    {
      id,
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature')
    },
    secret
  );
  if (!check.ok) return errorResponse(400, 'invalid_signature');

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return errorResponse(400, 'invalid');
  }
  const payload = toEmailEvent(id!, event);
  if (!payload) return received('ignored');

  const { data, error } = await createAnonClient().rpc('email_ingest_event', {
    p_key: key,
    p_event: payload
  });
  if (error) {
    console.error('email webhook not recorded', error.code ?? '', payload.type);
    return errorResponse(500, 'not_recorded');
  }
  return received((data as { status?: string } | null)?.status ?? 'recorded');
}

const received = (status: string) =>
  NextResponse.json({ received: true, status }, { headers: { 'Cache-Control': 'no-store' } });
