import { NextResponse, type NextRequest } from 'next/server';
import { onlinePaymentsConfig } from '@/lib/payments';
import { toBillingPaymentEvent } from '@/lib/payments/stripe-events';
import { verifyStripeSignature } from '@/lib/payments/stripe-signature';
import { createAnonClient } from '@/lib/supabase/anon';
import { errorResponse } from '@/lib/validation/http';

// Stripe webhook for LevelUp's own invoices. Off (404) unless online payments are
// on and the Stripe keys are set. The signature is checked on the raw body with LEVELUP_STRIPE_WEBHOOK_SECRET;
// the database call has no user session and authenticates with the billing
// webhook key (LEVELUP_BILLING_KEY, hashed in the database). The function checks
// the amount and the currency against the charge and ignores duplicates.
// Answers 2xx once the event is recorded (or deliberately ignored), 5xx when it
// must be retried by Stripe.

const MAX_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  const config = onlinePaymentsConfig();
  // Stripe keys present: its webhook keeps recording late events even when new
  // checkouts go through Square.
  const stripe = config?.stripe;
  if (!config || !stripe) return errorResponse(404, 'not_found');

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) return errorResponse(413, 'too_large');
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return errorResponse(413, 'too_large');

  const signature = verifyStripeSignature(
    raw,
    request.headers.get('stripe-signature'),
    stripe.webhookSecret
  );
  if (!signature.ok) return errorResponse(400, 'invalid_signature');

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return errorResponse(400, 'invalid');
  }
  const payload = toBillingPaymentEvent(event);
  if (!payload) return received('ignored');
  // Test events never touch live charges, and the other way round.
  if (payload.livemode !== stripe.livemode) return received('ignored');

  const { data, error } = await createAnonClient().rpc('billing_ingest_stripe_event', {
    p_key: config.billingKey,
    p_event: payload
  });
  if (error) {
    console.error('billing webhook not recorded', error.code ?? '', payload.type);
    return errorResponse(500, 'not_recorded');
  }
  return received((data as { status?: string } | null)?.status ?? 'recorded');
}

const received = (status: string) =>
  NextResponse.json({ received: true, status }, { headers: { 'Cache-Control': 'no-store' } });
