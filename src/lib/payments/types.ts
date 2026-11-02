/**
 * Payment provider abstraction for LevelUp's own invoices (not the clients'
 * websites: those report payments with site keys, see docs/site-api.md).
 * Two implementations, both server-only: Stripe Checkout (`./stripe.ts`) and Square
 * payment links (`./square.ts`). Which one is used is chosen by `./config.ts`.
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
  /** The charge the session was created for (Stripe metadata, Square payment note). */
  chargeId: string | null;
  /** Square: the order the payment link created (how the webhook finds the charge). */
  orderId?: string | null;
}

export interface PaymentProvider {
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  getCheckout(id: string): Promise<CheckoutSession>;
  /** Closes an open session (no-op answer when it is already closed). */
  expireCheckout(id: string): Promise<CheckoutSession>;
}

/** What the Stripe webhook passes to public.billing_ingest_stripe_event. */
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

/**
 * What the Square webhook passes to the same function (`provider: 'square'`). The
 * charge is found through the order the payment link created; the charge id read
 * from the payment note is a cross-check.
 */
export interface SquarePaymentEvent {
  provider: 'square';
  event_id: string;
  type: 'payment.created' | 'payment.updated';
  payment_id: string;
  order_id: string;
  charge_id: string;
  /** amount_money: minor units (cents), tips excluded. */
  amount: number | null;
  currency: string | null;
  /** APPROVED | PENDING | COMPLETED | CANCELED | FAILED */
  payment_status: string | null;
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
