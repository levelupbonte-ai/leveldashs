import 'server-only';
import { createAnonClient } from '@/lib/supabase/anon';
import type { OnlinePaymentsConfig } from './config';
import type { PayPalProvider } from './paypal';
import { PAYPAL_ID, toPayPalPaymentEvent } from './paypal-form';

export type CaptureOutcome = 'paid' | 'pending' | 'not_due' | 'unknown' | 'failed';

/**
 * Captures an approved PayPal order for a LevelUp charge and records it.
 * Only orders LevelUp created for a charge that is still due are captured, so
 * an old order approved late never takes money for an invoice already paid.
 * The database (billing key, no user session) checks the amount and currency
 * and ignores duplicates (return page and webhook can both arrive).
 */
export async function captureAndRecord(
  config: OnlinePaymentsConfig,
  paypal: PayPalProvider,
  orderId: string
): Promise<CaptureOutcome> {
  if (!PAYPAL_ID.test(orderId)) return 'unknown';
  const db = createAnonClient();
  const { data: check, error } = await db.rpc('billing_paypal_order_check', {
    p_key: config.billingKey,
    p_order_id: orderId
  });
  if (error) return 'failed';
  const c = check as { known?: boolean; due?: boolean };
  if (!c.known) return 'unknown';
  if (!c.due) return 'not_due';

  const capture = await paypal.capture(orderId);
  if (!capture) return 'failed';
  const { data, error: ingestError } = await db.rpc('billing_ingest_stripe_event', {
    p_key: config.billingKey,
    p_event: toPayPalPaymentEvent(capture, {
      eventId: `CAP-${capture.captureId}`,
      livemode: config.paypal?.environment === 'production'
    })
  });
  if (ingestError) {
    console.error('paypal capture not recorded', ingestError.code ?? '');
    return 'failed';
  }
  const status = (data as { status?: string } | null)?.status;
  if (status === 'paid' || status === 'duplicate' || status === 'already_paid') return 'paid';
  return capture.status === 'PENDING' ? 'pending' : 'failed';
}
