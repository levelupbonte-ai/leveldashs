/** Stripe events about the automatic monthly payment (docs/billing.md: subscribe to these too). */
export const AUTOPAY_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed'
] as const;

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 255 ? v : null);
const idOf = (v: unknown) =>
  str(v) ?? (v && typeof v === 'object' ? str((v as { id?: unknown }).id) : null);

export interface AutopayEvent {
  subscriptionId: string;
  livemode: boolean;
  invoice: { id: string; amount_paid: number; currency: string; paid_at: number | null } | null;
}

/**
 * A verified Stripe event that concerns a subscription: which one (it is read
 * back from Stripe, never trusted from the payload) and, for a paid invoice,
 * what was paid. Null for every other event, including one-off checkouts.
 */
export function toAutopayEvent(event: unknown): AutopayEvent | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as {
    type?: unknown;
    livemode?: unknown;
    data?: { object?: Record<string, unknown> };
  };
  const type = str(e.type);
  const o = e.data?.object;
  if (!type || !o) return null;
  const livemode = e.livemode === true;
  let subscriptionId: string | null = null;
  let invoice: AutopayEvent['invoice'] = null;
  if (
    type.startsWith('customer.subscription.') &&
    (AUTOPAY_EVENTS as readonly string[]).includes(type)
  ) {
    subscriptionId = str(o.id);
  } else if (type === 'invoice.paid' || type === 'invoice.payment_failed') {
    subscriptionId = idOf(o.subscription);
    const id = str(o.id);
    if (type === 'invoice.paid' && id && typeof o.amount_paid === 'number') {
      const transitions = (o.status_transitions ?? {}) as { paid_at?: unknown };
      invoice = {
        id,
        amount_paid: o.amount_paid,
        currency: (str(o.currency) ?? 'usd').toLowerCase(),
        paid_at: typeof transitions.paid_at === 'number' ? transitions.paid_at : null
      };
    }
  } else if (type === 'checkout.session.completed' && o.mode === 'subscription') {
    subscriptionId = idOf(o.subscription);
  } else {
    return null;
  }
  if (!subscriptionId || !/^sub_[A-Za-z0-9]{6,64}$/.test(subscriptionId)) return null;
  return { subscriptionId, livemode, invoice };
}

/** What the database stores about a subscription (billing_autopay_sync). */
export interface AutopayState {
  organization_id: string;
  customer_id: string;
  subscription_id: string;
  status: string;
  plan_key: string | null;
  amount: number | null;
  currency: string | null;
  cancel_at_period_end: boolean;
  current_period_end: number | null;
  livemode: boolean;
  card: { brand: string; last4: string; exp_month: number; exp_year: number } | null;
  invoice?: { id: string; amount_paid: number; currency: string; paid_at: number | null };
}

type Json = Record<string, unknown>;

const text = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Json) : null);

const SUB_ID = /^sub_[A-Za-z0-9]{6,64}$/;
const CUS_ID = /^cus_[A-Za-z0-9]{6,64}$/;

/** The card of a payment method object (or null). */
function cardOf(pm: unknown): AutopayState['card'] {
  const card = obj(obj(pm)?.card);
  const last4 = text(card?.last4);
  if (!card || !last4 || !/^\d{4}$/.test(last4)) return null;
  return {
    brand:
      (text(card.brand) ?? 'card')
        .toLowerCase()
        .replace(/[^a-z_]/g, '')
        .slice(0, 20) || 'card',
    last4,
    exp_month: num(card.exp_month) ?? 1,
    exp_year: num(card.exp_year) ?? 2000
  };
}

/** A Stripe subscription (expanded) to the state LevelUp keeps; null when it is not one of ours. */
export function autopayStateOf(sub: Json): AutopayState | null {
  const id = text(sub.id);
  const metadata = obj(sub.metadata) ?? {};
  const org = text(metadata.organization_id);
  const customer = obj(sub.customer);
  const customerId = text(sub.customer) ?? text(customer?.id);
  if (!id || !SUB_ID.test(id) || !org || !customerId || !CUS_ID.test(customerId)) return null;
  const item = obj((obj(sub.items)?.data as unknown[] | undefined)?.[0]);
  const price = obj(item?.price);
  const card =
    cardOf(sub.default_payment_method) ??
    cardOf(obj(customer?.invoice_settings)?.default_payment_method);
  return {
    organization_id: org,
    customer_id: customerId,
    subscription_id: id,
    status: text(sub.status) ?? 'incomplete',
    plan_key: text(metadata.plan_key),
    amount: num(price?.unit_amount),
    currency: text(price?.currency),
    cancel_at_period_end: sub.cancel_at_period_end === true,
    current_period_end: num(sub.current_period_end) ?? num(item?.current_period_end),
    livemode: sub.livemode === true,
    card
  };
}
