import { NextResponse, type NextRequest } from 'next/server';
import {
  onlinePaymentsConfig,
  paymentProvider,
  PaymentProviderError,
  providerOfSession
} from '@/lib/payments';
import { createClient } from '@/lib/supabase/server';
import { errorResponse, isSameOrigin } from '@/lib/validation/http';
import { PATTERNS } from '@/lib/validation/sanitize';

// An owner or admin pays a LevelUp charge online (Stripe Checkout or a Square
// payment link, whichever the server is set up for). Off unless
// LEVELUP_ONLINE_PAYMENTS=on and the provider's keys are set (404 otherwise, see
// docs/billing.md). The database checks the role and the status and gives the
// exact amount (billing_checkout_prepare); the browser only names the charge.
// One attempt per charge at a time: double clicks reuse its idempotency key, so
// the provider answers with the same session / link.

interface Prepared {
  charge_id: string;
  organization_id: string;
  invoice_number: string;
  label: string;
  amount: number;
  currency: string;
  attempt: number;
  expires_at: string;
  session_id: string | null;
  previous_session_id: string | null;
}

const CODES: Record<string, [number, string]> = {
  charge_not_found: [404, 'not_found'],
  charge_closed: [409, 'charge_closed'],
  invalid_amount: [409, 'charge_closed']
};

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const config = onlinePaymentsConfig();
  if (!config) return errorResponse(404, 'not_found');
  if (!isSameOrigin(request)) return errorResponse(403, 'forbidden');
  const { id } = await ctx.params;
  if (!PATTERNS.uuid.test(id)) return errorResponse(404, 'not_found');

  const db = await createClient();
  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) return errorResponse(401, 'unauthenticated');

  const { data, error } = await db.rpc('billing_checkout_prepare', { p_charge: id });
  if (error) {
    const [status, code] =
      CODES[error.message] ?? (error.code === 'PT429' ? [429, 'rate_limited'] : [404, 'not_found']);
    return errorResponse(status, code);
  }
  const prep = data as Prepared;
  const provider = paymentProvider(config);
  if (!provider) return errorResponse(404, 'not_found');
  const origin = new URL(request.url).origin;

  try {
    // The attempt's session already exists: send the client back to it (through the
    // provider that created it, should the owner have switched since).
    if (prep.session_id) {
      const owner = paymentProvider(config, providerOfSession(prep.session_id));
      if (!owner) return errorResponse(409, 'payment_in_progress');
      const open = await owner.getCheckout(prep.session_id);
      // Only a session created for this very charge.
      if (open.chargeId !== prep.charge_id) return errorResponse(409, 'payment_in_progress');
      if (open.status === 'open' && open.url) return ok(open.url);
      return errorResponse(409, 'payment_in_progress');
    }
    // A new attempt: close the previous session first, so only one can be paid.
    if (prep.previous_session_id) {
      const owner = paymentProvider(config, providerOfSession(prep.previous_session_id));
      const previous = owner ? await owner.expireCheckout(prep.previous_session_id) : null;
      if (previous?.status === 'complete') return errorResponse(409, 'payment_in_progress');
    }
    const session = await provider.createCheckout({
      chargeId: prep.charge_id,
      organizationId: prep.organization_id,
      invoiceNumber: prep.invoice_number,
      description: `${prep.invoice_number} · ${prep.label}`,
      amount: prep.amount,
      currency: prep.currency,
      idempotencyKey: `levelup-charge-${prep.charge_id}-${prep.attempt}`,
      expiresAt: new Date(prep.expires_at),
      successUrl: `${origin}/dashboard/billing?payment=success`,
      cancelUrl: `${origin}/dashboard/billing?payment=cancelled`
    });
    const recorded =
      config.provider === 'square'
        ? await db.rpc('billing_checkout_record_square', {
            p_charge: prep.charge_id,
            p_attempt: prep.attempt,
            p_link_id: session.id,
            p_order_id: session.orderId ?? ''
          })
        : await db.rpc('billing_checkout_record', {
            p_charge: prep.charge_id,
            p_attempt: prep.attempt,
            p_session_id: session.id
          });
    // Square: the webhook finds the charge through the recorded order. Not recorded,
    // no link: the next click replays the same idempotency key and records it.
    if (recorded.error && config.provider === 'square') {
      return errorResponse(502, 'payment_unavailable');
    }
    if (session.status !== 'open' || !session.url) return errorResponse(409, 'payment_in_progress');
    return ok(session.url);
  } catch (e) {
    // Status and provider code only: never the key, never the request.
    console.error(
      'billing checkout failed',
      e instanceof PaymentProviderError ? `${e.status} ${e.code ?? ''}` : 'network'
    );
    return errorResponse(502, 'payment_unavailable');
  }
}

const ok = (url: string) =>
  NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
