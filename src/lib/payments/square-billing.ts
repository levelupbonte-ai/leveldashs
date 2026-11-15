import 'server-only';
import type { SquareConfig } from './config';
import {
  autopayStateOf,
  cardOf,
  type AutopayCard,
  type AutopayState
} from './square-autopay-events';
import { PaymentProviderError } from './types';

export type { AutopayCard, AutopayState };

// Automatic monthly payment of the LevelUp plan with Square Subscriptions (fetch,
// no SDK). The card is entered in Square's own secure fields in the browser (Web
// Payments SDK): the server only receives a one-time token, saves the card on the
// client's Square customer and starts a monthly subscription that Square charges
// itself. LevelUp keeps the card's brand, last 4 digits and expiry only. The
// access token comes from LEVELUP_SQUARE_ACCESS_TOKEN and is only sent to Square.

const BASE = {
  production: 'https://connect.squareup.com/v2',
  sandbox: 'https://connect.squareupsandbox.com/v2'
} as const;
const SQUARE_VERSION = '2025-01-23';
const TIMEOUT_MS = 15_000;
const ID = /^[A-Za-z0-9_-]{6,64}$/;
const CARD_ID = /^[A-Za-z0-9_:-]{6,128}$/;

export interface AutopayPlan {
  key: string;
  name: string;
  /** Minor units (cents). */
  amount: number;
  currency: string;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);

function checkId(id: string, re = ID) {
  if (!re.test(id)) throw new PaymentProviderError(400, 'invalid_id');
  return encodeURIComponent(id);
}

export function createSquareBilling(config: SquareConfig) {
  const api = BASE[config.environment];
  const livemode = config.environment === 'production';

  async function call(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<Json> {
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
    const json = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) {
      const first = obj(arr(json.errors)[0]);
      throw new PaymentProviderError(res.status, str(first?.code));
    }
    return json;
  }

  async function readCard(cardId: string | null): Promise<AutopayCard | null> {
    if (!cardId || !CARD_ID.test(cardId)) return null;
    try {
      return cardOf((await call('GET', `/cards/${checkId(cardId, CARD_ID)}`)).card);
    } catch {
      return null;
    }
  }

  return {
    livemode,
    locationId: config.locationId,

    async createCustomer(input: { organizationId: string; name: string; email: string | null }) {
      const json = await call('POST', '/customers', {
        idempotency_key: `luc-${input.organizationId}`,
        company_name: input.name.slice(0, 120),
        email_address: input.email ?? undefined,
        reference_id: input.organizationId
      });
      const id = str(obj(json.customer)?.id);
      if (!id) throw new PaymentProviderError(502, 'no_customer');
      return id;
    },

    /** Saves the card the client typed in Square's fields (one-time token) on their customer. */
    async saveCard(input: {
      customerId: string;
      organizationId: string;
      sourceId: string;
      verificationToken?: string | null;
      nonce: string;
    }) {
      const json = await call('POST', '/cards', {
        idempotency_key: `lu-card-${input.nonce}`,
        source_id: input.sourceId,
        verification_token: input.verificationToken ?? undefined,
        card: { customer_id: input.customerId, reference_id: input.organizationId }
      });
      const card = cardOf(json.card);
      if (!card) throw new PaymentProviderError(502, 'no_card');
      return card;
    },

    async disableCard(cardId: string) {
      try {
        await call('POST', `/cards/${checkId(cardId, CARD_ID)}/disable`, {});
      } catch {
        /* an old card left on file is harmless */
      }
    },

    /** The Square plan variation for this plan at this price (created once, then reused). */
    async createPlanVariation(plan: AutopayPlan) {
      const json = await call('POST', '/catalog/object', {
        idempotency_key: `lu-plan-${plan.key}-${plan.amount}-${plan.currency}`,
        object: {
          type: 'SUBSCRIPTION_PLAN',
          id: '#plan',
          subscription_plan_data: {
            name: `LevelUp ${plan.name}`.slice(0, 120),
            subscription_plan_variations: [
              {
                type: 'SUBSCRIPTION_PLAN_VARIATION',
                id: '#variation',
                subscription_plan_variation_data: {
                  name: `LevelUp ${plan.name} monthly`.slice(0, 120),
                  phases: [
                    {
                      cadence: 'MONTHLY',
                      ordinal: 0,
                      pricing: {
                        type: 'STATIC',
                        price_money: { amount: plan.amount, currency: plan.currency.toUpperCase() }
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      });
      const mapped = arr(json.id_mappings)
        .map(obj)
        .find((m) => m?.client_object_id === '#variation');
      const id =
        str(mapped?.object_id) ??
        str(
          obj(
            arr(
              obj(obj(json.catalog_object)?.subscription_plan_data)?.subscription_plan_variations
            )[0]
          )?.id
        );
      if (!id || !ID.test(id)) throw new PaymentProviderError(502, 'no_variation');
      return id;
    },

    /** Starts the monthly subscription: Square charges the saved card now and each month. */
    async subscribe(input: {
      customerId: string;
      cardId: string;
      variationId: string;
      organizationId: string;
      nonce: string;
    }) {
      const json = await call('POST', '/subscriptions', {
        idempotency_key: `lu-sub-${input.nonce}`,
        location_id: config.locationId,
        plan_variation_id: input.variationId,
        customer_id: input.customerId,
        card_id: input.cardId,
        timezone: 'America/Denver',
        source: { name: 'LevelUp' }
      });
      const id = str(obj(json.subscription)?.id);
      if (!id) throw new PaymentProviderError(502, 'no_subscription');
      return id;
    },

    async useCard(subscriptionId: string, cardId: string) {
      await call('PUT', `/subscriptions/${checkId(subscriptionId)}`, {
        subscription: { card_id: cardId }
      });
    },

    /** Stops the renewal: the plan runs until the end of the paid month. */
    async cancel(subscriptionId: string) {
      await call('POST', `/subscriptions/${checkId(subscriptionId)}/cancel`, {});
    },

    /** Takes back a pending cancellation. */
    async resume(subscriptionId: string) {
      const sub = await call('GET', `/subscriptions/${checkId(subscriptionId)}?include=actions`);
      const s = obj(sub.subscription) ?? {};
      const action = [...arr(s.actions), ...arr(sub.actions)]
        .map(obj)
        .find((a) => a?.type === 'CANCEL');
      const actionId = str(action?.id);
      if (!actionId) throw new PaymentProviderError(409, 'not_cancelling');
      await call(
        'DELETE',
        `/subscriptions/${checkId(subscriptionId)}/actions/${checkId(actionId)}`
      );
    },

    /** Another plan from the next monthly charge. */
    async swapPlan(subscriptionId: string, variationId: string) {
      await call('POST', `/subscriptions/${checkId(subscriptionId)}/swap-plan`, {
        new_plan_variation_id: variationId
      });
    },

    /** The subscription as LevelUp keeps it, read from Square itself (card and paid invoices included). */
    async readState(subscriptionId: string): Promise<AutopayState | null> {
      const json = await call('GET', `/subscriptions/${checkId(subscriptionId)}?include=actions`);
      const sub = obj(json.subscription);
      if (!sub) return null;
      if (!arr(sub.actions).length && arr(json.actions).length) sub.actions = json.actions;
      const customer = str(sub.customer_id);
      let invoices: unknown[] = [];
      if (customer && ID.test(customer)) {
        try {
          const found = await call('POST', '/invoices/search', {
            query: {
              filter: { location_ids: [config.locationId], customer_ids: [customer] },
              sort: { field: 'INVOICE_SORT_DATE', order: 'DESC' }
            },
            limit: 12
          });
          invoices = arr(found.invoices);
        } catch {
          invoices = [];
        }
      }
      return autopayStateOf(sub, await readCard(str(sub.card_id)), invoices, livemode);
    }
  };
}

export type SquareBilling = ReturnType<typeof createSquareBilling>;
