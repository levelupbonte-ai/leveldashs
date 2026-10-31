import 'server-only';
import type { SquareConfig } from './config';
import { chargeIdFromNote, paymentLinkBody } from './square-form';
import {
  PaymentProviderError,
  type CheckoutRequest,
  type CheckoutSession,
  type CheckoutStatus,
  type PaymentProvider
} from './types';

// Square Checkout API (payment links) over fetch, no SDK. The access token is passed
// in by `@/lib/payments` from LEVELUP_SQUARE_ACCESS_TOKEN; it is never logged and
// never leaves this module except in the Authorization header to Square.
//
// A "checkout" here is a payment link: its id is the session id, the order it
// creates is how the webhook finds the charge. Payment links do not expire on
// their own: expiring one deletes it, which cancels its order.

const BASE = {
  production: 'https://connect.squareup.com/v2',
  sandbox: 'https://connect.squareupsandbox.com/v2'
} as const;
const SQUARE_VERSION = '2025-01-23';
const TIMEOUT_MS = 15_000;

const LINK_ID = /^[A-Za-z0-9]{8,64}$/;

function linkPath(id: string) {
  if (!LINK_ID.test(id)) throw new PaymentProviderError(400, 'invalid_id');
  return `/online-checkout/payment-links/${id}`;
}

interface SquareLink {
  id?: unknown;
  url?: unknown;
  order_id?: unknown;
  payment_note?: unknown;
}

function orderStatus(state: unknown): CheckoutStatus {
  if (state === 'COMPLETED') return 'complete';
  if (state === 'CANCELED') return 'expired';
  return 'open';
}

export function createSquareProvider(config: SquareConfig): PaymentProvider {
  const api = BASE[config.environment];

  async function call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.accessToken}`,
      'Square-Version': SQUARE_VERSION,
      Accept: 'application/json'
    };
    const init: RequestInit = {
      method,
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${api}${path}`, init);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const first = Array.isArray(json.errors) ? (json.errors[0] as { code?: unknown }) : null;
      throw new PaymentProviderError(
        res.status,
        typeof first?.code === 'string' ? first.code : null
      );
    }
    return json;
  }

  async function order(orderId: string): Promise<CheckoutStatus> {
    if (!/^[A-Za-z0-9_-]{8,255}$/.test(orderId)) return 'open';
    const json = await call('GET', `/orders/${orderId}`);
    return orderStatus((json.order as { state?: unknown } | undefined)?.state);
  }

  async function toSession(link: SquareLink): Promise<CheckoutSession> {
    const orderId = typeof link.order_id === 'string' ? link.order_id : null;
    return {
      id: String(link.id ?? ''),
      url: typeof link.url === 'string' ? link.url : null,
      status: orderId ? await order(orderId) : 'open',
      chargeId: chargeIdFromNote(link.payment_note),
      orderId
    };
  }

  async function getCheckout(id: string): Promise<CheckoutSession> {
    try {
      const json = await call('GET', linkPath(id));
      return toSession((json.payment_link ?? {}) as SquareLink);
    } catch (error) {
      // A deleted link: nothing left to pay through it.
      if (error instanceof PaymentProviderError && error.status === 404) {
        return { id, url: null, status: 'expired', chargeId: null, orderId: null };
      }
      throw error;
    }
  }

  return {
    async createCheckout(request: CheckoutRequest) {
      const json = await call(
        'POST',
        '/online-checkout/payment-links',
        paymentLinkBody(request, config.locationId)
      );
      const link = (json.payment_link ?? {}) as SquareLink;
      // A fresh link's order is open; no need to ask Square again.
      return {
        id: String(link.id ?? ''),
        url: typeof link.url === 'string' ? link.url : null,
        status: 'open',
        chargeId: chargeIdFromNote(link.payment_note) ?? request.chargeId,
        orderId: typeof link.order_id === 'string' ? link.order_id : null
      };
    },
    getCheckout,
    async expireCheckout(id: string) {
      const current = await getCheckout(id);
      if (current.status !== 'open') return current;
      await call('DELETE', linkPath(id)).catch((error: unknown) => {
        if (!(error instanceof PaymentProviderError && error.status === 404)) throw error;
      });
      // Paid between the two calls: report it, so the route does not open another.
      return current.orderId && (await order(current.orderId)) === 'complete'
        ? { ...current, status: 'complete' }
        : { ...current, url: null, status: 'expired' };
    }
  };
}
