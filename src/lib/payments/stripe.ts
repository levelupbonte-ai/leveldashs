import 'server-only';
import { checkoutSessionParams, encodeForm } from './stripe-form';
import {
  PaymentProviderError,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentProvider
} from './types';

// Stripe REST API with fetch (no SDK). The secret key is passed in by
// `@/lib/payments` from LEVELUP_STRIPE_SECRET_KEY; it is never logged and never
// leaves this module except in the Authorization header to api.stripe.com.

const API = 'https://api.stripe.com/v1';
const API_VERSION = '2024-06-20';
const TIMEOUT_MS = 15_000;

function toSession(json: Record<string, unknown>): CheckoutSession {
  const status = json.status === 'complete' || json.status === 'expired' ? json.status : 'open';
  const metadata = (json.metadata ?? {}) as Record<string, unknown>;
  return {
    id: String(json.id ?? ''),
    url: typeof json.url === 'string' ? json.url : null,
    status,
    chargeId: typeof metadata.charge_id === 'string' ? metadata.charge_id : null
  };
}

function sessionPath(id: string) {
  if (!/^cs_(test|live)_[A-Za-z0-9]{8,250}$/.test(id)) {
    throw new PaymentProviderError(400, 'invalid_id');
  }
  return `/checkout/sessions/${id}`;
}

export function createStripeProvider(secretKey: string): PaymentProvider {
  async function call(
    method: 'GET' | 'POST',
    path: string,
    body?: string,
    idempotencyKey?: string
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': API_VERSION
    };
    if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const init: RequestInit = {
      method,
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    };
    if (method === 'POST') init.body = body ?? '';
    const res = await fetch(`${API}${path}`, init);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = json.error as { code?: unknown; type?: unknown } | undefined;
      const code =
        typeof err?.code === 'string' ? err.code : typeof err?.type === 'string' ? err.type : null;
      throw new PaymentProviderError(res.status, code);
    }
    return json;
  }

  return {
    async createCheckout(request: CheckoutRequest) {
      const json = await call(
        'POST',
        '/checkout/sessions',
        encodeForm(checkoutSessionParams(request)),
        request.idempotencyKey
      );
      return toSession(json);
    },
    async getCheckout(id: string) {
      return toSession(await call('GET', sessionPath(id)));
    },
    async expireCheckout(id: string) {
      try {
        return toSession(await call('POST', `${sessionPath(id)}/expire`, ''));
      } catch (error) {
        // Already expired or completed: report its real state.
        if (error instanceof PaymentProviderError && error.status === 400) {
          return toSession(await call('GET', sessionPath(id)));
        }
        throw error;
      }
    }
  };
}
