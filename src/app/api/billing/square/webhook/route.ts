import { NextResponse, type NextRequest } from 'next/server';
import { onlinePaymentsConfig } from '@/lib/payments';
import {
  toSquareCreditEvent,
  toSquareDemoEvent,
  toSquarePaymentEvent
} from '@/lib/payments/square-form';
import { sendDemoPaidEmails, type DemoPaid } from '@/lib/demo/emails';
import { verifySquareSignature } from '@/lib/payments/square-signature';
import { createAnonClient } from '@/lib/supabase/anon';
import { errorResponse } from '@/lib/validation/http';

// Square webhook for LevelUp's own invoices (subscribe to payment.updated; also
// accepts payment.created). Off (404) unless online payments are on and the Square
// keys are set. The signature (x-square-hmacsha256-signature) is checked on the raw
// body and the subscription's notification URL with
// LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY; the database call has no user session and
// authenticates with the billing webhook key (LEVELUP_BILLING_KEY, hashed in the
// database). The function finds the charge through the payment link's order,
// checks the amount and the currency, and ignores duplicates.
// Answers 2xx once the event is recorded (or deliberately ignored), 5xx when it
// must be retried by Square.

const MAX_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  const config = onlinePaymentsConfig();
  const square = config?.square;
  if (!config || !square) return errorResponse(404, 'not_found');

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) return errorResponse(413, 'too_large');
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return errorResponse(413, 'too_large');

  // Square signs the URL registered on the subscription, byte for byte.
  const url = new URL(request.url);
  const notificationUrl = square.webhookUrl ?? `${url.origin}${url.pathname}`;
  const signature = verifySquareSignature(
    raw,
    request.headers.get('x-square-hmacsha256-signature'),
    square.webhookSignatureKey,
    notificationUrl
  );
  if (!signature.ok) return errorResponse(400, 'invalid_signature');

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return errorResponse(400, 'invalid');
  }
  const payload = toSquarePaymentEvent(event, {
    locationId: square.locationId,
    livemode: square.environment === 'production'
  });
  if (!payload) {
    // A human demo's payment (levelup-ecosystem.com "Start a project").
    const demo = toSquareDemoEvent(event, { locationId: square.locationId });
    if (!demo) {
      // A LevelStudio credit top-up: the credits are granted to the buyer's account.
      const credit = toSquareCreditEvent(event, { locationId: square.locationId });
      if (!credit) return received('ignored');
      const out = await createAnonClient().rpc('studio_credit_ingest_square', {
        p_key: config.billingKey,
        p_event: credit
      });
      if (out.error) {
        console.error('studio credits not recorded', out.error.code ?? '');
        return errorResponse(500, 'not_recorded');
      }
      return received((out.data as { status?: string } | null)?.status ?? 'recorded');
    }
    const { data, error } = await createAnonClient().rpc('demo_ingest_square', {
      p_key: config.billingKey,
      p_event: demo
    });
    if (error) {
      console.error('demo payment not recorded', error.code ?? '');
      return errorResponse(500, 'not_recorded');
    }
    const result = data as (DemoPaid & { status: string }) | null;
    // The project reaches LevelUp now: the client gets the tracking link, the team an alert.
    if (result?.status === 'paid') {
      const amount = new Intl.NumberFormat(result.locale === 'fr' ? 'fr-CA' : 'en-US', {
        style: 'currency',
        currency: (demo.currency ?? 'usd').toUpperCase()
      }).format((demo.amount ?? 0) / 100);
      await sendDemoPaidEmails(result, amount);
    }
    return received(result?.status ?? 'recorded');
  }

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
