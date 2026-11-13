import type { CheckoutRequest, SquarePaymentEvent } from './types';

/**
 * Square payment links (Checkout API, `POST /v2/online-checkout/payment-links`) and
 * webhook payloads. Pure, unit tested; the HTTP calls live in `./square.ts`.
 * https://developer.squareup.com/reference/square/checkout-api/create-payment-link
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SQUARE_ID = /^[A-Za-z0-9_-]{8,255}$/;

/** The payment note Square copies onto the payment: carries the charge id back. */
export function squarePaymentNote(request: Pick<CheckoutRequest, 'chargeId' | 'invoiceNumber'>) {
  return `LevelUp ${request.invoiceNumber} charge ${request.chargeId}`.slice(0, 500);
}

/** The charge id written by `squarePaymentNote`, or null. */
export function chargeIdFromNote(note: unknown): string | null {
  if (typeof note !== 'string' || note.length > 500) return null;
  const match = /\bcharge ([0-9a-f-]{36})\b/.exec(note);
  return match && UUID.test(match[1]) ? match[1] : null;
}

export interface SquarePaymentLinkBody {
  idempotency_key: string;
  description: string;
  quick_pay: {
    name: string;
    price_money: { amount: number; currency: string };
    location_id: string;
  };
  checkout_options: {
    redirect_url: string;
    allow_tipping: false;
    enable_coupon: false;
    enable_loyalty: false;
    merchant_support_email?: string;
    accepted_payment_methods: {
      apple_pay: true;
      google_pay: true;
      cash_app_pay: true;
      afterpay_clearpay: false;
    };
  };
  pre_populated_data?: { buyer_email: string };
  payment_note: string;
}

const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,24}$/;
const cleanEmail = (v: string | null | undefined) => (v && EMAIL.test(v) ? v : null);

/**
 * The CreatePaymentLink body. Deterministic for one attempt (no clock, no user
 * locale or e-mail), so a replay with the same idempotency key is the same request.
 * The amount is the charge's, in minor units, as the database computed it.
 */
export function paymentLinkBody(
  request: CheckoutRequest,
  locationId: string
): SquarePaymentLinkBody {
  const buyer = cleanEmail(request.buyerEmail);
  const support = cleanEmail(request.supportEmail);
  return {
    idempotency_key: request.idempotencyKey.slice(0, 192),
    description: request.description.slice(0, 255),
    quick_pay: {
      name: (request.productName || request.description).slice(0, 255),
      price_money: { amount: request.amount, currency: request.currency.toUpperCase() },
      location_id: locationId
    },
    checkout_options: {
      redirect_url: request.successUrl,
      allow_tipping: false,
      // A LevelUp invoice has its own discounts: no Square coupon or loyalty box.
      enable_coupon: false,
      enable_loyalty: false,
      ...(support ? { merchant_support_email: support } : {}),
      // Wallets on the page (each shows only where the device and Square allow it).
      accepted_payment_methods: {
        apple_pay: true,
        google_pay: true,
        cash_app_pay: true,
        afterpay_clearpay: false
      }
    },
    ...(buyer ? { pre_populated_data: { buyer_email: buyer } } : {}),
    payment_note: squarePaymentNote(request)
  };
}

/** The Square webhook events LevelUp listens to (docs/billing.md). */
export const SQUARE_HANDLED_EVENTS = ['payment.created', 'payment.updated'] as const;

const str = (v: unknown, max = 255) =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

/**
 * A verified Square event to the database payload, or null when it is not a payment
 * of a LevelUp payment link at this location (other events, other locations,
 * payments without an order or without the LevelUp payment note). Money: `amount` in the currency's minor
 * units (cents), ISO currency code in upper case; stored in lower case.
 */
export function toSquarePaymentEvent(
  event: unknown,
  options: { locationId: string; livemode: boolean }
): SquarePaymentEvent | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as {
    type?: unknown;
    event_id?: unknown;
    data?: { type?: unknown; object?: { payment?: Record<string, unknown> } };
  };
  const type = str(e.type);
  if (!type || !(SQUARE_HANDLED_EVENTS as readonly string[]).includes(type)) return null;
  const eventId = str(e.event_id);
  const payment = e.data?.object?.payment;
  if (!eventId || !SQUARE_ID.test(eventId) || !payment || typeof payment !== 'object') return null;
  const paymentId = str(payment.id);
  const orderId = str(payment.order_id);
  if (!paymentId || !orderId || !SQUARE_ID.test(paymentId) || !SQUARE_ID.test(orderId)) {
    return null;
  }
  if (payment.location_id !== options.locationId) return null;
  // Only payments of LevelUp payment links (their note names the charge): the
  // location's other sales are none of the billing's business.
  const chargeId = chargeIdFromNote(payment.note);
  if (!chargeId) return null;
  const money = (payment.amount_money ?? {}) as { amount?: unknown; currency?: unknown };
  const currency = str(money.currency, 3);
  return {
    provider: 'square',
    event_id: eventId,
    type: type as SquarePaymentEvent['type'],
    payment_id: paymentId,
    order_id: orderId,
    charge_id: chargeId,
    amount:
      typeof money.amount === 'number' && Number.isSafeInteger(money.amount) ? money.amount : null,
    currency: currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toLowerCase() : null,
    payment_status: str(payment.status, 32),
    livemode: options.livemode
  };
}
