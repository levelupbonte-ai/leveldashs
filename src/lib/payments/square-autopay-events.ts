/** Square events about the automatic monthly payment (subscribe to these in Square too). */
export const SQUARE_AUTOPAY_EVENTS = [
  'subscription.created',
  'subscription.updated',
  'invoice.payment_made',
  'invoice.scheduled_charge_failed'
] as const;

const ID = /^[A-Za-z0-9_-]{6,64}$/;
const text = (v: unknown) => (typeof v === 'string' ? v : null);

/**
 * A verified Square event about a subscription at LevelUp's location: which
 * subscription to read back from Square (the payload itself is never trusted).
 * Null for every other event.
 */
export function toSquareAutopayEvent(
  event: unknown,
  options: { locationId: string }
): { subscriptionId: string } | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as { type?: unknown; data?: { object?: Record<string, unknown> } };
  const type = text(e.type);
  if (!type || !(SQUARE_AUTOPAY_EVENTS as readonly string[]).includes(type)) return null;
  const o = e.data?.object ?? {};
  const sub = (o.subscription ?? null) as Record<string, unknown> | null;
  const inv = (o.invoice ?? null) as Record<string, unknown> | null;
  const id = type.startsWith('subscription.') ? text(sub?.id) : text(inv?.subscription_id);
  const location = type.startsWith('subscription.') ? sub?.location_id : inv?.location_id;
  if (!id || !ID.test(id) || location !== options.locationId) return null;
  return { subscriptionId: id };
}

export interface AutopayCard {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}

/** What the database keeps about a subscription (billing_autopay_sync). */
export interface AutopayState {
  provider: 'square';
  customer_id: string;
  subscription_id: string;
  card_id: string | null;
  variation_id: string | null;
  status: 'active' | 'canceled' | 'unpaid' | 'paused' | 'incomplete';
  cancel_at_period_end: boolean;
  current_period_end: number | null;
  livemode: boolean;
  card: Omit<AutopayCard, 'id'> | null;
  invoices: Array<{ id: string; amount_paid: number; currency: string; paid_at: number | null }>;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);

/** A Square card object to what LevelUp may keep (never the number). */
export function cardOf(card: unknown): AutopayCard | null {
  const c = obj(card);
  const id = str(c?.id);
  const last4 = str(c?.last_4);
  if (!c || !id || !last4 || !/^\d{4}$/.test(last4)) return null;
  return {
    id,
    brand:
      (str(c.card_brand) ?? 'card')
        .toLowerCase()
        .replace(/[^a-z_]/g, '')
        .replace(/^american_express$/, 'amex')
        .replace(/^discover_diners$/, 'diners')
        .replace(/^china_unionpay$/, 'unionpay')
        .slice(0, 20) || 'card',
    last4,
    exp_month: num(c.exp_month) ?? 1,
    exp_year: num(c.exp_year) ?? 2000
  };
}

const STATUS: Record<string, AutopayState['status']> = {
  ACTIVE: 'active',
  PENDING: 'active',
  CANCELED: 'canceled',
  DEACTIVATED: 'unpaid',
  PAUSED: 'paused'
};

/** "2026-12-14" (the last day paid) to the unix time the next charge happens. */
function periodEnd(date: unknown): number | null {
  const d = str(date);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T12:00:00Z`);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** A Square subscription (and its card and paid invoices) to the state LevelUp keeps. */
export function autopayStateOf(
  sub: Json,
  card: AutopayCard | null,
  invoices: unknown[],
  livemode: boolean
): AutopayState | null {
  const id = str(sub.id);
  const customer = str(sub.customer_id);
  if (!id || !ID.test(id) || !customer || !ID.test(customer)) return null;
  const actions = arr(sub.actions).map(obj);
  const cancelling = Boolean(str(sub.canceled_date)) || actions.some((a) => a?.type === 'CANCEL');
  return {
    provider: 'square',
    customer_id: customer,
    subscription_id: id,
    card_id: str(sub.card_id),
    variation_id: str(sub.plan_variation_id),
    status: STATUS[str(sub.status) ?? ''] ?? 'incomplete',
    cancel_at_period_end: sub.status !== 'CANCELED' && cancelling,
    current_period_end: periodEnd(sub.charged_through_date),
    livemode,
    card: card
      ? { brand: card.brand, last4: card.last4, exp_month: card.exp_month, exp_year: card.exp_year }
      : null,
    invoices: invoices
      .map(obj)
      .filter((i): i is Json => Boolean(i) && i?.status === 'PAID' && i?.subscription_id === id)
      .map((i) => {
        const request = obj(arr(i.payment_requests)[0]);
        const paid =
          obj(request?.total_completed_amount_money) ?? obj(request?.computed_amount_money);
        const at = Date.parse(str(i.updated_at) ?? '');
        return {
          id: str(i.id) ?? '',
          amount_paid: num(paid?.amount) ?? 0,
          currency: (str(paid?.currency) ?? 'USD').toLowerCase(),
          paid_at: Number.isNaN(at) ? null : Math.floor(at / 1000)
        };
      })
      .filter((i) => ID.test(i.id) && i.amount_paid > 0)
      .slice(0, 12)
  };
}
