import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { onlinePaymentsConfig, PaymentProviderError, squareBilling } from '@/lib/payments';
import type { AutopayPlan, SquareBilling } from '@/lib/payments/square-billing';
import { createAnonClient } from '@/lib/supabase/anon';
import { createClient } from '@/lib/supabase/server';
import { errorResponse, readJsonBody } from '@/lib/validation/http';

// Automatic monthly payment of the LevelUp plan with Square. An owner or admin
// types the card in Square's own fields (the browser sends a one-time token, never
// the number); the server saves the card on the organization's Square customer
// and starts a Square subscription that charges it each month. They can also
// change the card, stop or resume the renewal, switch plan, or refresh the state.
// The database checks the role and gives the plan's price (billing_autopay_prepare);
// the browser only names the organization, the plan and the token. Every change is
// read back from Square and recorded (billing_autopay_sync); the Square webhook
// does the same when Square charges a month. Off (404) unless Square and
// LEVELUP_SQUARE_APPLICATION_ID are set.

const TOKEN = z
  .string()
  .min(10)
  .max(512)
  .regex(/^[A-Za-z0-9:_-]+$/);

const Body = z.strictObject({
  organizationId: z.uuid(),
  action: z.enum(['start', 'card', 'cancel', 'resume', 'switch', 'refresh']),
  planKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,31}$/)
    .optional(),
  sourceId: TOKEN.optional(),
  verificationToken: TOKEN.optional()
});

interface Prepared {
  organization_id: string;
  organization_name: string | null;
  email: string | null;
  provider: string | null;
  customer_id: string | null;
  subscription_id: string | null;
  card_id: string | null;
  status: string;
  plan_key: string | null;
  current_plan: string | null;
  plan: AutopayPlan | null;
  variations: Record<string, string>;
}

const LIVE = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused']);

export async function POST(request: NextRequest) {
  const billing = squareBilling();
  const config = onlinePaymentsConfig();
  if (!billing || !config) return errorResponse(404, 'not_found');
  const parsed = await readJsonBody(request, Body, { maxBytes: 2048 });
  if (!parsed.ok) return parsed.response;
  const { organizationId, action, planKey, sourceId, verificationToken } = parsed.data;
  const needsPlan = action === 'start' || action === 'switch';
  if ((needsPlan && !planKey) || ((action === 'start' || action === 'card') && !sourceId)) {
    return errorResponse(400, 'invalid');
  }

  const db = await createClient();
  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) return errorResponse(401, 'unauthenticated');
  const { data, error } = await db.rpc('billing_autopay_prepare', {
    p_org: organizationId,
    p_plan_key: needsPlan ? planKey : null
  });
  if (error) {
    if (error.code === 'PT403') return errorResponse(403, 'forbidden');
    if (error.code === 'PT429') return errorResponse(429, 'rate_limited');
    if (error.code === 'PT404') return errorResponse(404, 'plan_not_found');
    return errorResponse(409, 'unavailable');
  }
  const prep = data as Prepared;
  const db0 = createAnonClient();
  const key = config.billingKey;
  const live = Boolean(prep.subscription_id && LIVE.has(prep.status));
  // The same card token always gives the same Square request (a double click or a
  // retry cannot save the card twice or start two subscriptions).
  const nonce = createHash('sha256')
    .update(sourceId ?? crypto.randomUUID())
    .digest('hex')
    .slice(0, 32);

  /** The plan's Square variation at its current price (made once, then reused). */
  const variationFor = async (plan: AutopayPlan) => {
    const known = prep.variations?.[String(billing.livemode)];
    if (known) return known;
    const id = await billing.createPlanVariation(plan);
    await db0.rpc('billing_autopay_plan_put', {
      p_key: key,
      p_plan_key: plan.key,
      p_amount: plan.amount,
      p_currency: plan.currency,
      p_variation: id,
      p_live: billing.livemode
    });
    return id;
  };

  const sync = async (b: SquareBilling, subscriptionId: string) => {
    const state = await b.readState(subscriptionId);
    if (!state) return;
    const { error: syncError } = await db0.rpc('billing_autopay_sync', {
      p_key: key,
      p_state: state
    });
    if (syncError) console.error('billing.autopay_sync_failed', syncError.code ?? '');
  };

  try {
    if (action === 'start') {
      if (live) return errorResponse(409, 'already_on');
      if (!prep.plan) return errorResponse(400, 'invalid');
      let customerId = prep.provider === 'square' ? prep.customer_id : null;
      if (!customerId) {
        customerId = await billing.createCustomer({
          organizationId,
          name: prep.organization_name ?? 'LevelUp client',
          email: prep.email
        });
        const saved = await db0.rpc('billing_autopay_customer', {
          p_key: key,
          p_org: organizationId,
          p_provider: 'square',
          p_customer: customerId,
          p_live: billing.livemode
        });
        if (saved.error) return errorResponse(500, 'unavailable');
      }
      const card = await billing.saveCard({
        customerId,
        organizationId,
        sourceId: sourceId!,
        verificationToken,
        nonce
      });
      const variationId = await variationFor(prep.plan);
      const subscriptionId = await billing.subscribe({
        customerId,
        cardId: card.id,
        variationId,
        organizationId,
        nonce
      });
      await sync(billing, subscriptionId);
      return done();
    }

    if (!prep.subscription_id || prep.provider !== 'square') return errorResponse(409, 'not_on');
    if (action === 'refresh') {
      await sync(billing, prep.subscription_id);
      return done();
    }
    if (!live) return errorResponse(409, 'not_on');
    if (action === 'card') {
      const card = await billing.saveCard({
        customerId: prep.customer_id!,
        organizationId,
        sourceId: sourceId!,
        verificationToken,
        nonce
      });
      await billing.useCard(prep.subscription_id, card.id);
      if (prep.card_id && prep.card_id !== card.id) await billing.disableCard(prep.card_id);
    } else if (action === 'cancel') {
      await billing.cancel(prep.subscription_id);
    } else if (action === 'resume') {
      await billing.resume(prep.subscription_id);
    } else {
      if (!prep.plan) return errorResponse(400, 'invalid');
      if (prep.plan.key === (prep.plan_key ?? prep.current_plan)) {
        return errorResponse(409, 'already_on_plan');
      }
      await billing.swapPlan(prep.subscription_id, await variationFor(prep.plan));
    }
    await sync(billing, prep.subscription_id);
    return done();
  } catch (err) {
    const status = err instanceof PaymentProviderError ? err.status : 0;
    const code = err instanceof PaymentProviderError ? err.code : null;
    console.error('billing.autopay_failed', action, status, code ?? 'error');
    // A declined or unverified card: the client can try another one.
    if (status === 400 || status === 402) return errorResponse(402, 'card_declined');
    return errorResponse(502, 'provider_error');
  }
}

const done = () => NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
