import 'server-only';
import type { PayPalConfig } from './config';
import {
  approveUrl,
  captureOfOrder,
  orderBody,
  orderIdOf,
  orderStatus,
  sessionIdOf,
  type PayPalCapture
} from './paypal-form';
import {
  PaymentProviderError,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentProvider
} from './types';

// PayPal Orders v2 over fetch, no SDK. The client secret is passed in by
// `@/lib/payments` (LEVELUP_PAYPAL_CLIENT_SECRET); it is only ever sent to
// PayPal's token endpoint and never logged. Access tokens are kept in memory
// until shortly before they expire.

const BASE = {
  production: 'https://api-m.paypal.com',
  sandbox: 'https://api-m.sandbox.paypal.com'
} as const;
const TIMEOUT_MS = 15_000;

const tokens = new Map<string, { token: string; until: number }>();

export interface PayPalProvider extends PaymentProvider {
  /** Takes the money of an approved order (idempotent: a captured order is read back). */
  capture(orderId: string): Promise<PayPalCapture | null>;
  /** Asks PayPal whether a webhook delivery really comes from it. */
  verifyWebhook(headers: Headers, event: unknown): Promise<boolean>;
}

function toSession(order: Record<string, unknown>): CheckoutSession {
  const id = typeof order.id === 'string' ? order.id : '';
  const unit = Array.isArray(order.purchase_units)
    ? (order.purchase_units[0] as { custom_id?: unknown })
    : null;
  return {
    id: sessionIdOf(id),
    url: approveUrl(order),
    status: orderStatus(order.status),
    chargeId: typeof unit?.custom_id === 'string' ? unit.custom_id : null,
    orderId: id
  };
}

export function createPayPalProvider(config: PayPalConfig): PayPalProvider {
  const api = BASE[config.environment];

  async function accessToken(): Promise<string> {
    const cached = tokens.get(config.clientId);
    if (cached && cached.until > Date.now()) return cached.token;
    const res = await fetch(`${api}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (!res.ok || typeof json.access_token !== 'string')
      throw new PaymentProviderError(res.status || 502, 'auth');
    const ttl = typeof json.expires_in === 'number' ? json.expires_in : 300;
    tokens.set(config.clientId, {
      token: json.access_token,
      until: Date.now() + Math.max(60, ttl - 120) * 1000
    });
    return json.access_token;
  }

  async function call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    requestId?: string
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken()}`,
      Accept: 'application/json',
      Prefer: 'return=representation'
    };
    if (requestId) headers['PayPal-Request-Id'] = requestId.slice(0, 108);
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
      const detail = Array.isArray(json.details) ? (json.details[0] as { issue?: unknown }) : null;
      const code =
        typeof detail?.issue === 'string'
          ? detail.issue
          : typeof json.name === 'string'
            ? json.name
            : null;
      throw new PaymentProviderError(res.status, code);
    }
    return json;
  }

  async function getCheckout(sessionId: string): Promise<CheckoutSession> {
    const orderId = orderIdOf(sessionId);
    if (!orderId) throw new PaymentProviderError(400, 'invalid_id');
    try {
      return toSession(await call('GET', `/v2/checkout/orders/${orderId}`));
    } catch (error) {
      if (error instanceof PaymentProviderError && error.status === 404) {
        return { id: sessionId, url: null, status: 'expired', chargeId: null, orderId };
      }
      throw error;
    }
  }

  return {
    async createCheckout(request: CheckoutRequest) {
      const order = await call(
        'POST',
        '/v2/checkout/orders',
        orderBody(request, request.successUrl),
        request.idempotencyKey
      );
      const session = toSession(order);
      if (!session.chargeId) session.chargeId = request.chargeId;
      return session;
    },
    getCheckout,
    // PayPal orders cannot be cancelled: an unapproved order simply expires,
    // and LevelUp only captures an order while its charge is still due.
    async expireCheckout(sessionId: string) {
      const current = await getCheckout(sessionId);
      return current.status === 'complete' ? current : { ...current, url: null, status: 'expired' };
    },
    async capture(orderId: string) {
      try {
        const order = await call(
          'POST',
          `/v2/checkout/orders/${orderId}/capture`,
          {},
          `capture-${orderId}`
        );
        return captureOfOrder(order);
      } catch (error) {
        // Captured already (return page and webhook raced): read it back.
        if (error instanceof PaymentProviderError && error.status === 422) {
          return captureOfOrder(await call('GET', `/v2/checkout/orders/${orderId}`));
        }
        throw error;
      }
    },
    async verifyWebhook(headers: Headers, event: unknown) {
      const h = (name: string) => headers.get(name) ?? '';
      const certUrl = h('paypal-cert-url');
      if (!/^https:\/\/api(-m)?\.(sandbox\.)?paypal\.com\//.test(certUrl)) return false;
      try {
        const json = await call('POST', '/v1/notifications/verify-webhook-signature', {
          auth_algo: h('paypal-auth-algo'),
          cert_url: certUrl,
          transmission_id: h('paypal-transmission-id'),
          transmission_sig: h('paypal-transmission-sig'),
          transmission_time: h('paypal-transmission-time'),
          webhook_id: config.webhookId,
          webhook_event: event
        });
        return json.verification_status === 'SUCCESS';
      } catch {
        return false;
      }
    }
  };
}
