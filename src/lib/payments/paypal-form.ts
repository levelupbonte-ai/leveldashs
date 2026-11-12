import type { CheckoutRequest, CheckoutStatus } from './types';

/**
 * PayPal Orders v2 bodies and payloads, pure and unit tested; the HTTP calls
 * live in `./paypal.ts`.
 * https://developer.paypal.com/docs/api/orders/v2/
 *
 * A checkout is a PayPal order: its id (prefixed `pp_`) is the session id. The
 * payer approves it on PayPal; LevelUp captures it (return page or webhook),
 * and the capture is what the database records as the payment.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PAYPAL_ID = /^[A-Z0-9]{8,64}$/;

/** PayPal amounts without decimals. */
const ZERO_DECIMAL = new Set(['jpy', 'huf', 'twd']);

export const sessionIdOf = (orderId: string) => `pp_${orderId}`;
export function orderIdOf(sessionId: string): string | null {
  const id = sessionId.startsWith('pp_') ? sessionId.slice(3) : '';
  return PAYPAL_ID.test(id) ? id : null;
}

/** Minor units (cents) -> PayPal's decimal string ("12.50"). */
export function toPayPalValue(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('invalid amount');
  if (ZERO_DECIMAL.has(currency.toLowerCase())) return String(minor);
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

/** PayPal's decimal string -> minor units, or null when it is not a clean amount. */
export function fromPayPalValue(value: unknown, currency: unknown): number | null {
  if (typeof value !== 'string' || typeof currency !== 'string') return null;
  if (ZERO_DECIMAL.has(currency.toLowerCase()))
    return /^\d{1,12}$/.test(value) ? Number(value) : null;
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

export interface PayPalOrderBody {
  intent: 'CAPTURE';
  purchase_units: {
    reference_id: string;
    custom_id: string;
    invoice_id: string;
    description: string;
    amount: { currency_code: string; value: string };
  }[];
  payment_source: {
    paypal: {
      email_address?: string;
      experience_context: {
        brand_name: string;
        user_action: 'PAY_NOW';
        shipping_preference: 'NO_SHIPPING';
        return_url: string;
        cancel_url: string;
      };
    };
  };
}

/**
 * The create-order body. Deterministic for one attempt, so a replay with the
 * same PayPal-Request-Id is the same request. invoice_id is the invoice
 * number: PayPal refuses a second payment of the same invoice.
 */
export function orderBody(request: CheckoutRequest, returnUrl: string): PayPalOrderBody {
  return {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: request.chargeId,
        custom_id: request.chargeId,
        invoice_id: request.invoiceNumber.slice(0, 127),
        description: (request.productName || request.description).slice(0, 127),
        amount: {
          currency_code: request.currency.toUpperCase(),
          value: toPayPalValue(request.amount, request.currency)
        }
      }
    ],
    payment_source: {
      paypal: {
        // The payer's e-mail pre-filled on PayPal's sign-in.
        ...(request.buyerEmail &&
        /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,24}$/.test(request.buyerEmail)
          ? { email_address: request.buyerEmail }
          : {}),
        experience_context: {
          brand_name: 'LevelUp Ecosystem',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: returnUrl,
          cancel_url: request.cancelUrl
        }
      }
    }
  };
}

interface PayPalLink {
  rel?: unknown;
  href?: unknown;
}

/** Where the payer approves the order. */
export function approveUrl(order: { links?: unknown }): string | null {
  const links = Array.isArray(order.links) ? (order.links as PayPalLink[]) : [];
  for (const rel of ['payer-action', 'approve']) {
    const href = links.find((l) => l.rel === rel)?.href;
    if (typeof href === 'string' && /^https:\/\/www\.(sandbox\.)?paypal\.com\//.test(href))
      return href;
  }
  return null;
}

/** CREATED / APPROVED (not captured yet) are still open; COMPLETED is paid. */
export function orderStatus(status: unknown): CheckoutStatus {
  if (status === 'COMPLETED') return 'complete';
  if (status === 'VOIDED') return 'expired';
  return 'open';
}

export interface PayPalCapture {
  orderId: string;
  captureId: string;
  /** COMPLETED | PENDING | DECLINED | … */
  status: string;
  amount: number | null;
  currency: string | null;
  chargeId: string | null;
}

/** The capture inside an order (after POST …/capture or GET of a captured order). */
export function captureOfOrder(order: unknown): PayPalCapture | null {
  if (!order || typeof order !== 'object') return null;
  const o = order as { id?: unknown; purchase_units?: unknown };
  const unit = Array.isArray(o.purchase_units)
    ? (o.purchase_units[0] as { custom_id?: unknown; payments?: { captures?: unknown } })
    : null;
  const captures = Array.isArray(unit?.payments?.captures) ? unit.payments.captures : [];
  const c = captures[0] as
    | {
        id?: unknown;
        status?: unknown;
        amount?: { value?: unknown; currency_code?: unknown };
        custom_id?: unknown;
      }
    | undefined;
  if (typeof o.id !== 'string' || !PAYPAL_ID.test(o.id) || !c) return null;
  if (typeof c.id !== 'string' || !PAYPAL_ID.test(c.id) || typeof c.status !== 'string')
    return null;
  const currency =
    typeof c.amount?.currency_code === 'string' ? c.amount.currency_code.toLowerCase() : null;
  const custom = typeof c.custom_id === 'string' ? c.custom_id : unit?.custom_id;
  return {
    orderId: o.id,
    captureId: c.id,
    status: c.status,
    amount: fromPayPalValue(c.amount?.value, c.amount?.currency_code),
    currency: currency && /^[a-z]{3}$/.test(currency) ? currency : null,
    chargeId: typeof custom === 'string' && UUID.test(custom) ? custom : null
  };
}

/** The capture a PAYMENT.CAPTURE.* webhook event is about. */
export function captureOfWebhook(
  event: unknown
): (PayPalCapture & { eventId: string; type: string }) | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as { id?: unknown; event_type?: unknown; resource?: unknown };
  if (typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{8,255}$/.test(e.id)) return null;
  if (typeof e.event_type !== 'string' || !PAYPAL_CAPTURE_EVENTS.includes(e.event_type as never))
    return null;
  const r = (e.resource ?? {}) as {
    id?: unknown;
    status?: unknown;
    amount?: { value?: unknown; currency_code?: unknown };
    custom_id?: unknown;
    supplementary_data?: { related_ids?: { order_id?: unknown } };
  };
  const orderId = r.supplementary_data?.related_ids?.order_id;
  if (typeof orderId !== 'string' || !PAYPAL_ID.test(orderId)) return null;
  if (typeof r.id !== 'string' || !PAYPAL_ID.test(r.id) || typeof r.status !== 'string')
    return null;
  const currency =
    typeof r.amount?.currency_code === 'string' ? r.amount.currency_code.toLowerCase() : null;
  return {
    eventId: e.id,
    type: e.event_type,
    orderId,
    captureId: r.id,
    status: r.status,
    amount: fromPayPalValue(r.amount?.value, r.amount?.currency_code),
    currency: currency && /^[a-z]{3}$/.test(currency) ? currency : null,
    chargeId: typeof r.custom_id === 'string' && UUID.test(r.custom_id) ? r.custom_id : null
  };
}

/** The webhook events LevelUp listens to (docs/billing.md). */
export const PAYPAL_CAPTURE_EVENTS = [
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.PENDING',
  'PAYMENT.CAPTURE.DENIED'
] as const;

/** What a capture becomes for public.billing_ingest_stripe_event (provider 'paypal'). */
export function toPayPalPaymentEvent(
  capture: PayPalCapture,
  options: { eventId: string; type?: string; livemode: boolean }
) {
  const type =
    options.type ??
    (capture.status === 'COMPLETED'
      ? 'PAYMENT.CAPTURE.COMPLETED'
      : capture.status === 'PENDING'
        ? 'PAYMENT.CAPTURE.PENDING'
        : 'PAYMENT.CAPTURE.DENIED');
  return {
    provider: 'paypal' as const,
    event_id: options.eventId,
    type,
    order_id: capture.orderId,
    capture_id: capture.captureId,
    charge_id: capture.chargeId,
    amount: capture.amount,
    currency: capture.currency,
    payment_status: capture.status,
    livemode: options.livemode
  };
}
