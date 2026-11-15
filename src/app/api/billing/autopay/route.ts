import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { onlinePaymentsConfig, PaymentProviderError, stripeBilling } from '@/lib/payments';
import { createAnonClient } from '@/lib/supabase/anon';
import { createClient } from '@/lib/supabase/server';
import { errorResponse, readJsonBody } from '@/lib/validation/http';

// Automatic monthly payment of the LevelUp plan (Stripe Billing). An owner or
// admin turns it on (Stripe Checkout keeps the card), opens Stripe's page to
// change the card or download invoices, stops or resumes the renewal, or moves
// to another plan. The database checks the role and gives the plan's price
// (billing_autopay_prepare); the browser only names the organization and the
// plan. The webhook (../stripe/webhook) records what Stripe then does. Off (404)
// unless the Stripe keys are set.

const Body = z.strictObject({
  organizationId: z.uuid(),
  action: z.enum(['start', 'portal', 'cancel', 'resume', 'switch']),
  planKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,31}$/)
    .optional(),
  locale: z.enum(['en', 'fr']).optional()
});

interface Prepared {
  organization_id: string;
  organization_name: string | null;
  email: string | null;
  customer_id: string | null;
  subscription_id: string | null;
  status: string;
  current_plan: string | null;
  plan: { key: string; name: string; amount: number; currency: string } | null;
}

const LIVE = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete']);

export async function POST(request: NextRequest) {
  const billing = stripeBilling();
  const config = onlinePaymentsConfig();
  if (!billing || !config?.stripe) return errorResponse(404, 'not_found');
  const parsed = await readJsonBody(request, Body, { maxBytes: 1024 });
  if (!parsed.ok) return parsed.response;
  const { organizationId, action, planKey, locale = 'en' } = parsed.data;
  if ((action === 'start' || action === 'switch') && !planKey) {
    return errorResponse(400, 'invalid');
  }

  const db = await createClient();
  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) return errorResponse(401, 'unauthenticated');
  const { data, error } = await db.rpc('billing_autopay_prepare', {
    p_org: organizationId,
    p_plan_key: action === 'start' || action === 'switch' ? planKey : null
  });
  if (error) {
    if (error.code === 'PT403') return errorResponse(403, 'forbidden');
    if (error.code === 'PT429') return errorResponse(429, 'rate_limited');
    if (error.code === 'PT404') return errorResponse(404, 'plan_not_found');
    return errorResponse(409, 'unavailable');
  }
  const prep = data as Prepared;
  const back = `${new URL(request.url).origin}/dashboard/billing`;
  const live = Boolean(prep.subscription_id && LIVE.has(prep.status));

  try {
    if (action === 'start') {
      if (live) return errorResponse(409, 'already_on');
      if (!prep.plan) return errorResponse(400, 'invalid');
      let customerId = prep.customer_id;
      if (!customerId) {
        customerId = await billing.createCustomer({
          organizationId,
          name: prep.organization_name ?? 'LevelUp client',
          email: prep.email
        });
        const saved = await createAnonClient().rpc('billing_autopay_customer', {
          p_key: config.billingKey,
          p_org: organizationId,
          p_customer: customerId,
          p_live: config.stripe.livemode
        });
        if (saved.error) return errorResponse(500, 'unavailable');
      }
      const url = await billing.subscriptionCheckout({
        customerId,
        organizationId,
        plan: prep.plan,
        successUrl: `${back}?autopay=on`,
        cancelUrl: `${back}?autopay=cancelled`,
        locale
      });
      return ok(url);
    }
    if (action === 'portal') {
      if (!prep.customer_id) return errorResponse(409, 'not_on');
      return ok(await billing.portal({ customerId: prep.customer_id, returnUrl: back, locale }));
    }
    if (!prep.subscription_id || !live) return errorResponse(409, 'not_on');
    if (action === 'cancel' || action === 'resume') {
      await billing.setCancelAtPeriodEnd(prep.subscription_id, action === 'cancel');
    } else {
      if (!prep.plan) return errorResponse(400, 'invalid');
      if (prep.plan.key === prep.current_plan) return errorResponse(409, 'already_on_plan');
      await billing.changePlan(prep.subscription_id, prep.plan);
    }
    // The page shows the new state at once; the webhook confirms it.
    const state = await billing.readState(prep.subscription_id);
    if (state) {
      await createAnonClient().rpc('billing_autopay_sync', {
        p_key: config.billingKey,
        p_state: state
      });
    }
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const status = err instanceof PaymentProviderError ? err.status : 0;
    console.error(
      'billing.autopay_failed',
      action,
      status,
      err instanceof PaymentProviderError ? err.code : 'error'
    );
    return errorResponse(502, 'provider_error');
  }
}

const ok = (url: string) =>
  NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
