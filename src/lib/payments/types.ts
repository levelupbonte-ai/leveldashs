/**
 * Payment provider abstraction for LevelUp's own invoices (not the clients'
 * websites: those report payments with site keys, see docs/site-api.md).
 * One implementation today: Stripe Checkout (`./stripe.ts`, server-only).
 */

export interface CheckoutRequest {
  chargeId: string;
  organizationId: string;
  invoiceNumber: string;
  /** Shown on the payment page: "LU-2026-0001 · Website setup". */
  description: string;
  /** Minor units, exactly as computed by the database. */
  amount: number;
  currency: string;
  /** Stable for one attempt, so a double click replays the same request. */
  idempotencyKey: string;
  expiresAt: Date;
  successUrl: string;
  cancelUrl: string;
}

export type CheckoutStatus = 'open' | 'complete' | 'expired';

export interface CheckoutSession {
  id: string;
  url: string | null;
  status: CheckoutStatus;
  /** metadata.charge_id set when the session was created. */
  chargeId: string | null;
}

export interface PaymentProvider {
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  getCheckout(id: string): Promise<CheckoutSession>;
  /** Closes an open session (no-op answer when it is already closed). */
  expireCheckout(id: string): Promise<CheckoutSession>;
}

/** What the webhook passes to public.billing_ingest_stripe_event. */
export interface BillingPaymentEvent {
  event_id: string;
  type:
    | 'checkout.session.completed'
    | 'checkout.session.async_payment_succeeded'
    | 'checkout.session.async_payment_failed'
    | 'checkout.session.expired';
  session_id: string;
  charge_id: string | null;
  organization_id: string | null;
  amount: number | null;
  currency: string | null;
  payment_status: string | null;
  payment_intent: string | null;
  livemode: boolean;
}

export class PaymentProviderError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super(`payment provider error ${status}${code ? ` ${code}` : ''}`);
    this.name = 'PaymentProviderError';
    this.status = status;
    this.code = code;
  }
}
