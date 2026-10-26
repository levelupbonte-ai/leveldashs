// Run with `bun test` (node:test API). Online payment helpers: the off switch,
// Stripe signature checks, event mapping and the deterministic checkout request.
import { describe, it as test } from 'node:test';
import assert from 'node:assert/strict';
import { readOnlinePaymentsConfig } from './config';
import { HANDLED_EVENTS, toBillingPaymentEvent } from './stripe-events';
import { checkoutSessionParams, encodeForm } from './stripe-form';
import { parseSignatureHeader, signPayload, verifyStripeSignature } from './stripe-signature';

const KEYS = {
  LEVELUP_ONLINE_PAYMENTS: 'on',
  LEVELUP_STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(24),
  LEVELUP_STRIPE_WEBHOOK_SECRET: 'whsec_' + 'b'.repeat(32),
  LEVELUP_BILLING_KEY: 'lu_bill_' + '0123456789abcdef'.repeat(3)
};

describe('online payments switch (disabled by default)', () => {
  test('off with no environment at all', () => {
    assert.equal(readOnlinePaymentsConfig({}), null);
  });
  test('off when the flag is missing or not "on", even with every key', () => {
    assert.equal(readOnlinePaymentsConfig({ ...KEYS, LEVELUP_ONLINE_PAYMENTS: undefined }), null);
    assert.equal(readOnlinePaymentsConfig({ ...KEYS, LEVELUP_ONLINE_PAYMENTS: 'true' }), null);
    assert.equal(readOnlinePaymentsConfig({ ...KEYS, LEVELUP_ONLINE_PAYMENTS: 'off' }), null);
  });
  test('off when any key is missing or malformed', () => {
    for (const key of [
      'LEVELUP_STRIPE_SECRET_KEY',
      'LEVELUP_STRIPE_WEBHOOK_SECRET',
      'LEVELUP_BILLING_KEY'
    ] as const) {
      assert.equal(readOnlinePaymentsConfig({ ...KEYS, [key]: undefined }), null, key);
      assert.equal(readOnlinePaymentsConfig({ ...KEYS, [key]: '' }), null, key);
      assert.equal(readOnlinePaymentsConfig({ ...KEYS, [key]: 'nope' }), null, key);
    }
    // A publishable key is never a secret key.
    assert.equal(
      readOnlinePaymentsConfig({ ...KEYS, LEVELUP_STRIPE_SECRET_KEY: 'pk_live_' + 'a'.repeat(24) }),
      null
    );
  });
  test('NEXT_PUBLIC_ copies are ignored', () => {
    assert.equal(
      readOnlinePaymentsConfig({
        NEXT_PUBLIC_LEVELUP_ONLINE_PAYMENTS: 'on',
        NEXT_PUBLIC_LEVELUP_STRIPE_SECRET_KEY: KEYS.LEVELUP_STRIPE_SECRET_KEY,
        NEXT_PUBLIC_LEVELUP_STRIPE_WEBHOOK_SECRET: KEYS.LEVELUP_STRIPE_WEBHOOK_SECRET,
        NEXT_PUBLIC_LEVELUP_BILLING_KEY: KEYS.LEVELUP_BILLING_KEY
      }),
      null
    );
  });
  test('on with the flag and every key; mode follows the secret key', () => {
    const test = readOnlinePaymentsConfig(KEYS);
    assert.ok(test);
    assert.equal(test.livemode, false);
    const live = readOnlinePaymentsConfig({
      ...KEYS,
      LEVELUP_ONLINE_PAYMENTS: ' ON ',
      LEVELUP_STRIPE_SECRET_KEY: 'rk_live_' + 'c'.repeat(24)
    });
    assert.equal(live?.livemode, true);
  });
});

describe('Stripe signature', () => {
  const secret = KEYS.LEVELUP_STRIPE_WEBHOOK_SECRET;
  const body = '{"id":"evt_1","type":"checkout.session.completed"}';
  const now = 1_790_000_000_000;
  const t = now / 1000;
  const header = (sig: string, ts = t) => `t=${ts},v1=${sig}`;

  test('a correct signature over the raw body is accepted', () => {
    assert.deepEqual(
      verifyStripeSignature(body, header(signPayload(body, secret, t)), secret, { now }),
      {
        ok: true
      }
    );
  });
  test('any of several v1 signatures may match (secret rotation)', () => {
    const h = `t=${t},v1=${'0'.repeat(64)},v1=${signPayload(body, secret, t)},v0=abc`;
    assert.equal(verifyStripeSignature(body, h, secret, { now }).ok, true);
  });
  test('a changed body, another secret or another timestamp is refused', () => {
    const sig = signPayload(body, secret, t);
    assert.deepEqual(verifyStripeSignature(body + ' ', header(sig), secret, { now }), {
      ok: false,
      reason: 'mismatch'
    });
    assert.equal(verifyStripeSignature(body, header(sig), 'whsec_other0000000', { now }).ok, false);
    assert.equal(verifyStripeSignature(body, header(sig, t + 1), secret, { now }).ok, false);
  });
  test('old or future timestamps are refused (replay)', () => {
    const old = t - 301;
    assert.deepEqual(
      verifyStripeSignature(body, header(signPayload(body, secret, old), old), secret, { now }),
      { ok: false, reason: 'expired' }
    );
    const future = t + 301;
    assert.equal(
      verifyStripeSignature(body, header(signPayload(body, secret, future), future), secret, {
        now
      }).ok,
      false
    );
  });
  test('missing or malformed headers are refused', () => {
    assert.deepEqual(verifyStripeSignature(body, null, secret, { now }), {
      ok: false,
      reason: 'missing'
    });
    for (const h of [
      'garbage',
      `t=${t}`,
      `v1=${'a'.repeat(64)}`,
      `t=abc,v1=${'a'.repeat(64)}`,
      `t=${t},v1=xyz`
    ]) {
      assert.deepEqual(verifyStripeSignature(body, h, secret, { now }), {
        ok: false,
        reason: 'malformed'
      });
    }
    assert.equal(parseSignatureHeader('x'.repeat(3000)), null);
  });
});

describe('Stripe events', () => {
  const session = {
    object: 'checkout.session',
    id: 'cs_test_a1b2c3d4e5',
    amount_total: 2000,
    currency: 'USD',
    payment_status: 'paid',
    payment_intent: 'pi_123',
    metadata: { charge_id: 'c-1', organization_id: 'o-1', invoice_number: 'LU-2026-0001' }
  };
  test('a completed checkout maps to the database payload', () => {
    assert.deepEqual(
      toBillingPaymentEvent({
        id: 'evt_1',
        type: 'checkout.session.completed',
        livemode: false,
        data: { object: session }
      }),
      {
        event_id: 'evt_1',
        type: 'checkout.session.completed',
        session_id: 'cs_test_a1b2c3d4e5',
        charge_id: 'c-1',
        organization_id: 'o-1',
        amount: 2000,
        currency: 'usd',
        payment_status: 'paid',
        payment_intent: 'pi_123',
        livemode: false
      }
    );
  });
  test('other events and other objects are ignored', () => {
    assert.equal(
      toBillingPaymentEvent({ id: 'evt_1', type: 'charge.succeeded', data: { object: session } }),
      null
    );
    assert.equal(
      toBillingPaymentEvent({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: { object: { ...session, object: 'payment_intent' } }
      }),
      null
    );
    assert.equal(toBillingPaymentEvent(null), null);
    assert.equal(HANDLED_EVENTS.length, 4);
  });
  test('missing metadata gives null ids (the database answers unknown_charge)', () => {
    const e = toBillingPaymentEvent({
      id: 'evt_2',
      type: 'checkout.session.expired',
      livemode: true,
      data: { object: { ...session, metadata: {}, payment_intent: { id: 'pi_9' } } }
    });
    assert.equal(e?.charge_id, null);
    assert.equal(e?.payment_intent, 'pi_9');
    assert.equal(e?.livemode, true);
  });
});

describe('checkout request', () => {
  const request = {
    chargeId: 'c-1',
    organizationId: 'o-1',
    invoiceNumber: 'LU-2026-0001',
    description: 'LU-2026-0001 · Website setup',
    amount: 120000,
    currency: 'USD',
    idempotencyKey: 'levelup-charge-c-1-1',
    expiresAt: new Date('2026-10-26T18:00:00Z'),
    successUrl: 'https://dashboard.example/dashboard/billing?payment=success',
    cancelUrl: 'https://dashboard.example/dashboard/billing?payment=cancelled'
  };
  test('the same attempt always encodes the same request (safe idempotent replay)', () => {
    assert.equal(
      encodeForm(checkoutSessionParams(request)),
      encodeForm(checkoutSessionParams({ ...request }))
    );
  });
  test('exact amount, lower-case currency, metadata with the charge and the organization', () => {
    const form = new URLSearchParams(encodeForm(checkoutSessionParams(request)));
    assert.equal(form.get('mode'), 'payment');
    assert.equal(form.get('line_items[0][price_data][unit_amount]'), '120000');
    assert.equal(form.get('line_items[0][price_data][currency]'), 'usd');
    assert.equal(form.get('metadata[charge_id]'), 'c-1');
    assert.equal(form.get('metadata[organization_id]'), 'o-1');
    assert.equal(form.get('payment_intent_data[metadata][charge_id]'), 'c-1');
    assert.equal(form.get('expires_at'), String(Date.parse('2026-10-26T18:00:00Z') / 1000));
    assert.equal(form.get('success_url'), request.successUrl);
  });
  test('form encoding: nested keys, nulls dropped, values escaped', () => {
    assert.equal(
      encodeForm({ a: { b: [1, null, 'x y&z'] }, c: undefined }),
      'a%5Bb%5D%5B0%5D=1&a%5Bb%5D%5B2%5D=x%20y%26z'
    );
  });
});
