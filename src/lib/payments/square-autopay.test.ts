// Run with `bun test` (node:test API). Automatic monthly payment on Square: which
// webhook events concern a subscription, and what LevelUp keeps of one (never the
// card number: brand, last 4 digits, expiry).
import { it as test } from 'node:test';
import assert from 'node:assert/strict';
import { readSquareConfig } from './config';
import { autopayStateOf, cardOf, toSquareAutopayEvent } from './square-autopay-events';

const LOC = 'LOC12345';

test('subscription and invoice events at our location name the subscription; others are ignored', () => {
  assert.deepEqual(
    toSquareAutopayEvent(
      {
        type: 'subscription.updated',
        data: { object: { subscription: { id: 'SUB123456', location_id: LOC } } }
      },
      { locationId: LOC }
    ),
    { subscriptionId: 'SUB123456' }
  );
  assert.deepEqual(
    toSquareAutopayEvent(
      {
        type: 'invoice.payment_made',
        data: { object: { invoice: { subscription_id: 'SUB123456', location_id: LOC } } }
      },
      { locationId: LOC }
    ),
    { subscriptionId: 'SUB123456' }
  );
  assert.equal(
    toSquareAutopayEvent(
      { type: 'invoice.payment_made', data: { object: { invoice: { location_id: LOC } } } },
      { locationId: LOC }
    ),
    null
  );
  assert.equal(
    toSquareAutopayEvent(
      {
        type: 'subscription.updated',
        data: { object: { subscription: { id: 'SUB123456', location_id: 'OTHER123' } } }
      },
      { locationId: LOC }
    ),
    null
  );
  assert.equal(
    toSquareAutopayEvent({ type: 'payment.updated', data: { object: {} } }, { locationId: LOC }),
    null
  );
});

test('a Square subscription becomes the state LevelUp keeps', () => {
  const card = cardOf({
    id: 'ccof:abc123',
    card_brand: 'AMERICAN_EXPRESS',
    last_4: '0005',
    exp_month: 4,
    exp_year: 2030,
    bin: '378282'
  });
  assert.deepEqual(card, {
    id: 'ccof:abc123',
    brand: 'amex',
    last4: '0005',
    exp_month: 4,
    exp_year: 2030
  });
  const state = autopayStateOf(
    {
      id: 'SUB123456',
      customer_id: 'CUST123456',
      card_id: 'ccof:abc123',
      plan_variation_id: 'VAR123456',
      status: 'ACTIVE',
      charged_through_date: '2026-12-14',
      actions: [{ id: 'ACT1', type: 'CANCEL' }]
    },
    card,
    [
      {
        id: 'INV123456',
        status: 'PAID',
        subscription_id: 'SUB123456',
        updated_at: '2026-11-14T10:00:00Z',
        payment_requests: [{ total_completed_amount_money: { amount: 9900, currency: 'USD' } }]
      },
      { id: 'INV999999', status: 'UNPAID', subscription_id: 'SUB123456', payment_requests: [] },
      {
        id: 'INV888888',
        status: 'PAID',
        subscription_id: 'OTHERSUB1',
        payment_requests: [{ total_completed_amount_money: { amount: 100, currency: 'USD' } }]
      }
    ],
    true
  );
  assert.equal(state?.status, 'active');
  assert.equal(state?.cancel_at_period_end, true);
  assert.equal(state?.variation_id, 'VAR123456');
  assert.equal(state?.current_period_end, Date.parse('2026-12-14T12:00:00Z') / 1000);
  assert.deepEqual(state?.card, { brand: 'amex', last4: '0005', exp_month: 4, exp_year: 2030 });
  assert.deepEqual(state?.invoices, [
    {
      id: 'INV123456',
      amount_paid: 9900,
      currency: 'usd',
      paid_at: Date.parse('2026-11-14T10:00:00Z') / 1000
    }
  ]);
  assert.equal(
    autopayStateOf(
      { id: 'SUB123456', status: 'DEACTIVATED', customer_id: 'CUST123456' },
      null,
      [],
      false
    )?.status,
    'unpaid'
  );
  assert.equal(autopayStateOf({ id: 'x', customer_id: 'CUST123456' }, null, [], false), null);
});

test('the public application id switches the automatic payment on; anything else keeps it off', () => {
  const base = {
    LEVELUP_SQUARE_ACCESS_TOKEN: 'EAAA' + 'a'.repeat(60),
    LEVELUP_SQUARE_LOCATION_ID: 'L' + 'A'.repeat(12),
    LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY: 'k'.repeat(22),
    LEVELUP_SQUARE_ENV: 'production'
  };
  const off = readSquareConfig(base);
  assert.equal(off?.applicationId, null);
  assert.ok(off);
  const on = readSquareConfig({
    ...base,
    LEVELUP_SQUARE_APPLICATION_ID: 'sq0idp-' + 'b'.repeat(22)
  });
  assert.equal(on?.applicationId, 'sq0idp-' + 'b'.repeat(22));
  const bad = readSquareConfig({ ...base, LEVELUP_SQUARE_APPLICATION_ID: 'EAAAsecret' });
  assert.equal(bad?.applicationId, null);
  assert.ok(bad);
});
