import type { BillingPaymentEvent } from './types';

/** The Checkout events LevelUp listens to (docs/billing.md: subscribe to exactly these). */
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired'
] as const;

const str = (v: unknown, max = 255) =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

/**
 * A verified Stripe event to the database payload, or null when the event is not
 * one we handle (or not shaped like a Checkout Session). The charge and the
 * organization come from the session metadata the checkout route set.
 */
export function toBillingPaymentEvent(event: unknown): BillingPaymentEvent | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as {
    id?: unknown;
    type?: unknown;
    livemode?: unknown;
    data?: { object?: Record<string, unknown> };
  };
  const type = str(e.type);
  if (!type || !(HANDLED_EVENTS as readonly string[]).includes(type)) return null;
  const id = str(e.id);
  const session = e.data?.object;
  if (!id || !session || session.object !== 'checkout.session') return null;
  const sessionId = str(session.id);
  if (!sessionId) return null;
  const metadata = (session.metadata ?? {}) as Record<string, unknown>;
  const intent = session.payment_intent;
  return {
    event_id: id,
    type: type as BillingPaymentEvent['type'],
    session_id: sessionId,
    charge_id: str(metadata.charge_id, 64),
    organization_id: str(metadata.organization_id, 64),
    amount: typeof session.amount_total === 'number' ? session.amount_total : null,
    currency: str(session.currency, 3)?.toLowerCase() ?? null,
    payment_status: str(session.payment_status, 32),
    payment_intent:
      str(intent) ??
      (intent && typeof intent === 'object' ? str((intent as { id?: unknown }).id) : null),
    livemode: e.livemode === true
  };
}
