import { NextResponse, type NextRequest } from 'next/server';
import { onlinePaymentsConfig, paypalProvider } from '@/lib/payments';
import { captureAndRecord } from '@/lib/payments/paypal-capture';
import { captureOfWebhook, PAYPAL_ID, toPayPalPaymentEvent } from '@/lib/payments/paypal-form';
import { createAnonClient } from '@/lib/supabase/anon';
import { errorResponse } from '@/lib/validation/http';

// PayPal webhook for LevelUp's own invoices. Subscribe the app's webhook
// (its id in LEVELUP_PAYPAL_WEBHOOK_ID) to CHECKOUT.ORDER.APPROVED,
// PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.PENDING, PAYMENT.CAPTURE.DENIED.
// Each delivery is verified with PayPal (verify-webhook-signature) before
// anything happens. An approved order is captured here when the payer never
// came back; captures are recorded with the billing key. Answers 2xx once
// handled (or deliberately ignored), 5xx when PayPal must retry.

const MAX_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  const config = onlinePaymentsConfig();
  const paypal = config ? paypalProvider(config) : null;
  if (!config || !paypal) return errorResponse(404, 'not_found');

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) return errorResponse(413, 'too_large');
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return errorResponse(413, 'too_large');
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return errorResponse(400, 'invalid');
  }
  if (!(await paypal.verifyWebhook(request.headers, event))) {
    return errorResponse(400, 'invalid_signature');
  }

  const type = (event as { event_type?: unknown }).event_type;
  if (type === 'CHECKOUT.ORDER.APPROVED') {
    const orderId = (event as { resource?: { id?: unknown } }).resource?.id;
    if (typeof orderId !== 'string' || !PAYPAL_ID.test(orderId)) return received('ignored');
    try {
      const outcome = await captureAndRecord(config, paypal, orderId);
      return outcome === 'failed' ? errorResponse(500, 'not_recorded') : received(outcome);
    } catch {
      return errorResponse(500, 'not_recorded');
    }
  }

  const capture = captureOfWebhook(event);
  if (!capture) return received('ignored');
  const { data, error } = await createAnonClient().rpc('billing_ingest_stripe_event', {
    p_key: config.billingKey,
    p_event: toPayPalPaymentEvent(capture, {
      eventId: capture.eventId,
      type: capture.type,
      livemode: config.paypal?.environment === 'production'
    })
  });
  if (error) {
    console.error('paypal webhook not recorded', error.code ?? '', capture.type);
    return errorResponse(500, 'not_recorded');
  }
  return received((data as { status?: string } | null)?.status ?? 'recorded');
}

const received = (status: string) =>
  NextResponse.json({ received: true, status }, { headers: { 'Cache-Control': 'no-store' } });
