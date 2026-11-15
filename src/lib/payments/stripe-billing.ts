import 'server-only';
import { encodeForm } from './stripe-form';
import { autopayStateOf, type AutopayState } from './stripe-autopay-events';
import { PaymentProviderError } from './types';

// Automatic monthly payment of the LevelUp plan with Stripe Billing (fetch, no
// SDK). Stripe keeps the card: LevelUp only ever reads its brand, last 4 digits
// and expiry. The secret key comes from LEVELUP_STRIPE_SECRET_KEY through
// `@/lib/payments` and is only sent to api.stripe.com.

const API = 'https://api.stripe.com/v1';
const API_VERSION = '2024-06-20';
const TIMEOUT_MS = 15_000;

export interface AutopayPlan {
  key: string;
  name: string;
  /** Minor units (cents). */
  amount: number;
  currency: string;
}

type Json = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Json) : null);
const SUB_ID = /^sub_[A-Za-z0-9]{6,64}$/;

export type { AutopayState };

function subPath(id: string) {
  if (!SUB_ID.test(id)) throw new PaymentProviderError(400, 'invalid_id');
  return `/subscriptions/${id}`;
}

export function createStripeBilling(secretKey: string) {
  async function call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Json,
    idempotencyKey?: string
  ): Promise<Json> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': API_VERSION
    };
    if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const init: RequestInit = {
      method,
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    };
    if (method === 'POST') {
      init.body = encodeForm((body ?? {}) as Parameters<typeof encodeForm>[0]);
    }
    const res = await fetch(`${API}${path}`, init);
    const json = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) {
      const err = obj(json.error);
      throw new PaymentProviderError(res.status, str(err?.code) ?? str(err?.type));
    }
    return json;
  }

  return {
    async createCustomer(input: { organizationId: string; name: string; email: string | null }) {
      const json = await call(
        'POST',
        '/customers',
        {
          name: input.name.slice(0, 120),
          email: input.email ?? undefined,
          metadata: { organization_id: input.organizationId }
        },
        `lu-customer-${input.organizationId}`
      );
      return String(json.id);
    },

    /** A Stripe Checkout page that starts the monthly subscription (card kept by Stripe). */
    async subscriptionCheckout(input: {
      customerId: string;
      organizationId: string;
      plan: AutopayPlan;
      successUrl: string;
      cancelUrl: string;
      locale: string;
    }) {
      const metadata = { organization_id: input.organizationId, plan_key: input.plan.key };
      const json = await call('POST', '/checkout/sessions', {
        mode: 'subscription',
        customer: input.customerId,
        client_reference_id: input.organizationId,
        locale: input.locale === 'fr' ? 'fr' : 'en',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.plan.currency.toLowerCase(),
              unit_amount: input.plan.amount,
              recurring: { interval: 'month' },
              product_data: { name: `LevelUp · ${input.plan.name}`.slice(0, 120) }
            }
          }
        ],
        metadata,
        subscription_data: { metadata },
        payment_method_collection: 'always',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl
      });
      const url = str(json.url);
      if (!url) throw new PaymentProviderError(502, 'no_url');
      return url;
    },

    /** Stripe's own page to change the card and see the invoices. */
    async portal(input: { customerId: string; returnUrl: string; locale: string }) {
      const open = (configuration?: string) =>
        call('POST', '/billing_portal/sessions', {
          customer: input.customerId,
          return_url: input.returnUrl,
          locale: input.locale === 'fr' ? 'fr' : 'en',
          configuration
        });
      let json: Json;
      try {
        json = await open();
      } catch (error) {
        // No portal set up on the Stripe account yet: card, invoices and cancel only.
        if (!(error instanceof PaymentProviderError) || error.status !== 400) throw error;
        const config = await call(
          'POST',
          '/billing_portal/configurations',
          {
            business_profile: { headline: 'LevelUp' },
            features: {
              payment_method_update: { enabled: true },
              invoice_history: { enabled: true },
              customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] },
              subscription_cancel: { enabled: true, mode: 'at_period_end' }
            }
          },
          'lu-portal-config-v1'
        );
        json = await open(String(config.id));
      }
      const url = str(json.url);
      if (!url) throw new PaymentProviderError(502, 'no_url');
      return url;
    },

    /** Stops (or resumes) the renewal at the end of the paid month. */
    async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean) {
      return call('POST', subPath(subscriptionId), { cancel_at_period_end: cancel });
    },

    /** Another plan from the next invoice, the difference prorated on it. */
    async changePlan(subscriptionId: string, plan: AutopayPlan) {
      const sub = await call('GET', subPath(subscriptionId));
      const item = obj((obj(sub.items)?.data as unknown[] | undefined)?.[0]);
      const itemId = str(item?.id);
      const product = str(obj(item?.price)?.product);
      if (!itemId || !product) throw new PaymentProviderError(409, 'no_item');
      const metadata = {
        ...((obj(sub.metadata) ?? {}) as Record<string, string>),
        plan_key: plan.key
      };
      await call('POST', `/products/${encodeURIComponent(product)}`, {
        name: `LevelUp · ${plan.name}`.slice(0, 120)
      });
      return call('POST', subPath(subscriptionId), {
        items: [
          {
            id: itemId,
            price_data: {
              currency: plan.currency.toLowerCase(),
              unit_amount: plan.amount,
              recurring: { interval: 'month' },
              product
            }
          }
        ],
        proration_behavior: 'create_prorations',
        cancel_at_period_end: false,
        metadata
      });
    },

    /** The subscription as LevelUp keeps it (card included), read from Stripe itself. */
    async readState(subscriptionId: string): Promise<AutopayState | null> {
      const sub = await call(
        'GET',
        `${subPath(subscriptionId)}?expand[]=default_payment_method&expand[]=customer.invoice_settings.default_payment_method`
      );
      return autopayStateOf(sub);
    }
  };
}

export type StripeBilling = ReturnType<typeof createStripeBilling>;
