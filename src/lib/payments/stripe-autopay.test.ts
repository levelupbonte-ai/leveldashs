// Run with `bun test` (node:test API). Automatic monthly payment: which Stripe
// events concern a subscription, and what LevelUp keeps of one (never the card
// number: its brand, last 4 digits and expiry only).
import { it as test } from 'node:test';
import assert from 'node:assert/strict';
import { autopayStateOf, toAutopayEvent } from './stripe-autopay-events';

const ORG = '11111111-2222-4333-8444-555555555555';

test('subscription events, paid invoices and subscription checkouts are routed; one-off checkouts are not', () => {
  assert.deepEqual(
    toAutopayEvent({
      type: 'customer.subscription.updated',
      livemode: true,
      data: { object: { id: 'sub_ABC12345' } }
    }),
    {
      subscriptionId: 'sub_ABC12345',
      livemode: true,
      invoice: null
    }
  );
  const paid = toAutopayEvent({
    type: 'invoice.paid',
    livemode: false,
    data: {
      object: {
        id: 'in_ABC12345',
        subscription: 'sub_ABC12345',
        amount_paid: 9900,
        currency: 'USD',
        status_transitions: { paid_at: 1794700000 }
      }
    }
  });
  assert.deepEqual(paid?.invoice, {
    id: 'in_ABC12345',
    amount_paid: 9900,
    currency: 'usd',
    paid_at: 1794700000
  });
  assert.equal(
    toAutopayEvent({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription: 'sub_ABC12345' } }
    })?.subscriptionId,
    'sub_ABC12345'
  );
  assert.equal(
    toAutopayEvent({ type: 'checkout.session.completed', data: { object: { mode: 'payment' } } }),
    null
  );
  assert.equal(
    toAutopayEvent({ type: 'invoice.paid', data: { object: { id: 'in_ABC12345' } } }),
    null
  );
  assert.equal(
    toAutopayEvent({ type: 'customer.subscription.updated', data: { object: { id: 'nope' } } }),
    null
  );
  assert.equal(toAutopayEvent({ type: 'charge.refunded', data: { object: {} } }), null);
});

test('a subscription becomes the state LevelUp keeps: card brand, last 4 and expiry only', () => {
  const state = autopayStateOf({
    id: 'sub_ABC12345',
    status: 'active',
    customer: 'cus_ABC12345',
    livemode: true,
    cancel_at_period_end: true,
    current_period_end: 1800000000,
    metadata: { organization_id: ORG, plan_key: 'pro' },
    items: { data: [{ price: { unit_amount: 9900, currency: 'usd' } }] },
    default_payment_method: {
      card: { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028, fingerprint: 'x' }
    }
  });
  assert.deepEqual(state, {
    organization_id: ORG,
    customer_id: 'cus_ABC12345',
    subscription_id: 'sub_ABC12345',
    status: 'active',
    plan_key: 'pro',
    amount: 9900,
    currency: 'usd',
    cancel_at_period_end: true,
    current_period_end: 1800000000,
    livemode: true,
    card: { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028 }
  });
  // The customer's default card when the subscription has none of its own.
  const viaCustomer = autopayStateOf({
    id: 'sub_ABC12345',
    status: 'past_due',
    customer: {
      id: 'cus_ABC12345',
      invoice_settings: {
        default_payment_method: {
          card: { brand: 'mastercard', last4: '0005', exp_month: 1, exp_year: 2030 }
        }
      }
    },
    metadata: { organization_id: ORG },
    items: {
      data: [{ current_period_end: 1800000001, price: { unit_amount: 3900, currency: 'usd' } }]
    }
  });
  assert.equal(viaCustomer?.card?.last4, '0005');
  assert.equal(viaCustomer?.current_period_end, 1800000001);
  // Not one of ours (no organization), or malformed ids.
  assert.equal(
    autopayStateOf({ id: 'sub_ABC12345', customer: 'cus_ABC12345', metadata: {} }),
    null
  );
  assert.equal(
    autopayStateOf({ id: 'sub_ABC12345', customer: 'x', metadata: { organization_id: ORG } }),
    null
  );
});
