// Run with `bun test` (node:test API). Square: webhook signature, payment link body,
// webhook payload mapping and the provider selection.
import { describe, it as test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readOnlinePaymentsConfig, selectProvider } from './config';
import {
  chargeIdFromNote,
  paymentLinkBody,
  squarePaymentNote,
  toSquarePaymentEvent
} from './square-form';
import { signSquarePayload, verifySquareSignature } from './square-signature';
import type { CheckoutRequest } from './types';

const BILLING = 'lu_bill_' + '0123456789abcdef'.repeat(3);
const STRIPE = {
  LEVELUP_STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(24),
  LEVELUP_STRIPE_WEBHOOK_SECRET: 'whsec_' + 'b'.repeat(32)
};
const SQUARE = {
  LEVELUP_SQUARE_ACCESS_TOKEN: 'EAAA' + 'x'.repeat(60),
  LEVELUP_SQUARE_LOCATION_ID: 'L88917AVBK2S5',
  LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY: 'sigkey_' + 'Zz9'.repeat(6),
  LEVELUP_SQUARE_ENV: 'sandbox'
};
const ON = { LEVELUP_ONLINE_PAYMENTS: 'on', LEVELUP_BILLING_KEY: BILLING };

const CHARGE = '6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
const HOOK_URL = 'https://dashboard.levelup-ecosystem.com/api/billing/square/webhook';

describe('provider selection', () => {
  test('off with no provider keys, even with the flag and the billing key', () => {
    assert.equal(readOnlinePaymentsConfig(ON), null);
  });
  test('unset: the provider with complete keys', () => {
    assert.equal(readOnlinePaymentsConfig({ ...ON, ...STRIPE })?.provider, 'stripe');
    const square = readOnlinePaymentsConfig({ ...ON, ...SQUARE });
    assert.equal(square?.provider, 'square');
    assert.equal(square?.stripe, null);
    assert.equal(square?.square?.environment, 'sandbox');
    assert.equal(square?.square?.webhookUrl, null);
  });
  test('unset with both complete: Stripe; both stay available to their webhooks', () => {
    const both = readOnlinePaymentsConfig({ ...ON, ...STRIPE, ...SQUARE });
    assert.equal(both?.provider, 'stripe');
    assert.ok(both?.stripe && both.square);
  });
  test('LEVELUP_PAYMENT_PROVIDER picks one, and needs its keys', () => {
    assert.equal(
      readOnlinePaymentsConfig({ ...ON, ...STRIPE, ...SQUARE, LEVELUP_PAYMENT_PROVIDER: 'square' })
        ?.provider,
      'square'
    );
    assert.equal(
      readOnlinePaymentsConfig({
        ...ON,
        ...STRIPE,
        ...SQUARE,
        LEVELUP_PAYMENT_PROVIDER: ' Stripe '
      })?.provider,
      'stripe'
    );
    // Forced provider without its keys: off, never a silent fallback.
    assert.equal(
      readOnlinePaymentsConfig({ ...ON, ...STRIPE, LEVELUP_PAYMENT_PROVIDER: 'square' }),
      null
    );
    assert.equal(
      readOnlinePaymentsConfig({ ...ON, ...SQUARE, LEVELUP_PAYMENT_PROVIDER: 'stripe' }),
      null
    );
    // Unknown provider: off.
    assert.equal(
      readOnlinePaymentsConfig({ ...ON, ...STRIPE, LEVELUP_PAYMENT_PROVIDER: 'paypal' }),
      null
    );
  });
  test('selectProvider alone', () => {
    const s = { secretKey: 'k', webhookSecret: 'w', livemode: false };
    const q = {
      accessToken: 't',
      locationId: 'L',
      webhookSignatureKey: 'k',
      environment: 'production' as const,
      webhookUrl: null
    };
    assert.equal(selectProvider({}, null, null), null);
    assert.equal(selectProvider({}, s, q), 'stripe');
    assert.equal(selectProvider({}, null, q), 'square');
    assert.equal(selectProvider({ LEVELUP_PAYMENT_PROVIDER: 'square' }, s, null), null);
  });
  test('Square keys incomplete or malformed: Square is not configured', () => {
    for (const key of Object.keys(SQUARE) as (keyof typeof SQUARE)[]) {
      assert.equal(readOnlinePaymentsConfig({ ...ON, ...SQUARE, [key]: undefined }), null, key);
      assert.equal(readOnlinePaymentsConfig({ ...ON, ...SQUARE, [key]: 'bad value!' }), null, key);
    }
    assert.equal(readOnlinePaymentsConfig({ ...ON, ...SQUARE, LEVELUP_SQUARE_ENV: 'live' }), null);
    assert.equal(
      readOnlinePaymentsConfig({
        ...ON,
        ...SQUARE,
        LEVELUP_SQUARE_WEBHOOK_URL: 'http://insecure.test/x'
      }),
      null
    );
    assert.equal(
      readOnlinePaymentsConfig({ ...ON, ...SQUARE, LEVELUP_SQUARE_WEBHOOK_URL: HOOK_URL })?.square
        ?.webhookUrl,
      HOOK_URL
    );
  });
  test('the flag and the billing key are still required; NEXT_PUBLIC_ copies ignored', () => {
    assert.equal(readOnlinePaymentsConfig({ ...SQUARE, LEVELUP_BILLING_KEY: BILLING }), null);
    assert.equal(readOnlinePaymentsConfig({ ...SQUARE, LEVELUP_ONLINE_PAYMENTS: 'on' }), null);
    assert.equal(
      readOnlinePaymentsConfig({
        ...ON,
        NEXT_PUBLIC_LEVELUP_SQUARE_ACCESS_TOKEN: SQUARE.LEVELUP_SQUARE_ACCESS_TOKEN,
        NEXT_PUBLIC_LEVELUP_SQUARE_LOCATION_ID: SQUARE.LEVELUP_SQUARE_LOCATION_ID,
        NEXT_PUBLIC_LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY:
          SQUARE.LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY,
        NEXT_PUBLIC_LEVELUP_SQUARE_ENV: 'production'
      }),
      null
    );
  });
});

describe('Square signature (x-square-hmacsha256-signature)', () => {
  const key = SQUARE.LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY;
  const body = '{"merchant_id":"M1","type":"payment.updated","event_id":"e1"}';

  test('matches Square’s scheme: base64 HMAC-SHA256 of HOOK_URL + raw body', () => {
    const expected = createHmac('sha256', key)
      .update(HOOK_URL + body)
      .digest('base64');
    assert.equal(signSquarePayload(HOOK_URL, body, key), expected);
  });
  test('valid signature', () => {
    assert.deepEqual(
      verifySquareSignature(body, signSquarePayload(HOOK_URL, body, key), key, HOOK_URL),
      {
        ok: true
      }
    );
  });
  test('invalid: other key, other HOOK_URL, missing or malformed header', () => {
    const other = signSquarePayload(HOOK_URL, body, 'another-key-123');
    assert.deepEqual(verifySquareSignature(body, other, key, HOOK_URL), {
      ok: false,
      reason: 'mismatch'
    });
    const otherUrl = signSquarePayload(HOOK_URL + '/', body, key);
    assert.deepEqual(verifySquareSignature(body, otherUrl, key, HOOK_URL), {
      ok: false,
      reason: 'mismatch'
    });
    assert.deepEqual(verifySquareSignature(body, null, key, HOOK_URL), {
      ok: false,
      reason: 'missing'
    });
    assert.deepEqual(verifySquareSignature(body, 'not base64!', key, HOOK_URL), {
      ok: false,
      reason: 'malformed'
    });
    // A hex digest (Stripe style) is not Square's format.
    const hex = createHmac('sha256', key)
      .update(HOOK_URL + body)
      .digest('hex');
    assert.equal(verifySquareSignature(body, hex, key, HOOK_URL).ok, false);
  });
  test('tampered body', () => {
    const sig = signSquarePayload(HOOK_URL, body, key);
    assert.deepEqual(verifySquareSignature(body.replace('M1', 'M2'), sig, key, HOOK_URL), {
      ok: false,
      reason: 'mismatch'
    });
    assert.deepEqual(verifySquareSignature(body + ' ', sig, key, HOOK_URL), {
      ok: false,
      reason: 'mismatch'
    });
  });
});

const REQUEST: CheckoutRequest = {
  chargeId: CHARGE,
  organizationId: '11111111-2222-4333-8444-555555555555',
  invoiceNumber: 'LU-2026-0007',
  description: 'LU-2026-0007 · Website setup',
  amount: 120050,
  currency: 'usd',
  idempotencyKey: `levelup-charge-${CHARGE}-2`,
  expiresAt: new Date('2026-10-31T12:00:00Z'),
  successUrl: 'https://dashboard.levelup-ecosystem.com/dashboard/billing?payment=success',
  cancelUrl: 'https://dashboard.levelup-ecosystem.com/dashboard/billing?payment=cancelled'
};

describe('Square payment link body', () => {
  test('quick_pay with the exact amount in cents, the location and the idempotency key', () => {
    const body = paymentLinkBody(REQUEST, 'L88917AVBK2S5');
    assert.equal(body.idempotency_key, `levelup-charge-${CHARGE}-2`);
    assert.deepEqual(body.quick_pay, {
      name: 'LU-2026-0007 · Website setup',
      price_money: { amount: 120050, currency: 'USD' },
      location_id: 'L88917AVBK2S5'
    });
    assert.equal(body.checkout_options.redirect_url, REQUEST.successUrl);
    assert.equal(body.checkout_options.allow_tipping, false);
    assert.equal(chargeIdFromNote(body.payment_note), CHARGE);
  });
  test('clear product name, wallets, pre-filled payer e-mail and support e-mail', () => {
    const body = paymentLinkBody(
      {
        ...REQUEST,
        productName: 'LevelUp Ecosystem — Website setup (LU-2026-0007)',
        buyerEmail: 'owner@client.example',
        supportEmail: 'billing@levelup-ecosystem.com'
      },
      'L1'
    );
    assert.equal(body.quick_pay.name, 'LevelUp Ecosystem — Website setup (LU-2026-0007)');
    assert.deepEqual(body.pre_populated_data, { buyer_email: 'owner@client.example' });
    assert.equal(body.checkout_options.merchant_support_email, 'billing@levelup-ecosystem.com');
    assert.deepEqual(body.checkout_options.accepted_payment_methods, {
      apple_pay: true,
      google_pay: true,
      cash_app_pay: true,
      afterpay_clearpay: false
    });
    // Missing or malformed e-mails are left out, never sent.
    const bare = paymentLinkBody(
      { ...REQUEST, buyerEmail: 'not an email', supportEmail: null },
      'L1'
    );
    assert.equal(bare.pre_populated_data, undefined);
    assert.equal(bare.checkout_options.merchant_support_email, undefined);
  });
  test('deterministic: the same attempt sends the same bytes', () => {
    assert.equal(
      JSON.stringify(paymentLinkBody(REQUEST, 'L1')),
      JSON.stringify(paymentLinkBody({ ...REQUEST }, 'L1'))
    );
  });
  test('payment note round trip; other notes name no charge', () => {
    assert.equal(chargeIdFromNote(squarePaymentNote(REQUEST)), CHARGE);
    assert.equal(chargeIdFromNote('Haircut, tip included'), null);
    assert.equal(chargeIdFromNote('charge not-a-uuid-at-all-not-a-uuid-at-al'), null);
    assert.equal(chargeIdFromNote(null), null);
  });
});

const squareEvent = (payment: Record<string, unknown>, type = 'payment.updated') => ({
  merchant_id: 'MLR6Z7KMTF8RS',
  type,
  event_id: '6a8f5f28-54a1-4eb0-a98a-3111513fd4fc',
  created_at: '2026-10-31T12:00:00Z',
  data: {
    type: 'payment',
    id: 'hYy9pRFVxpDsO1FB05SunFWUe9JZY',
    object: {
      payment: {
        id: 'hYy9pRFVxpDsO1FB05SunFWUe9JZY',
        status: 'COMPLETED',
        amount_money: { amount: 120050, currency: 'USD' },
        total_money: { amount: 120050, currency: 'USD' },
        order_id: 'f8jZ9dQ8nNyiV2dZAhgW1g3BH1PZY',
        location_id: 'L88917AVBK2S5',
        note: squarePaymentNote(REQUEST),
        ...payment
      }
    }
  }
});

describe('Square webhook payload mapping', () => {
  const opts = { locationId: 'L88917AVBK2S5', livemode: true };

  test('completed payment: order, payment id, charge, cents and lower-case currency', () => {
    assert.deepEqual(toSquarePaymentEvent(squareEvent({}), opts), {
      provider: 'square',
      event_id: '6a8f5f28-54a1-4eb0-a98a-3111513fd4fc',
      type: 'payment.updated',
      payment_id: 'hYy9pRFVxpDsO1FB05SunFWUe9JZY',
      order_id: 'f8jZ9dQ8nNyiV2dZAhgW1g3BH1PZY',
      charge_id: CHARGE,
      amount: 120050,
      currency: 'usd',
      payment_status: 'COMPLETED',
      livemode: true
    });
    assert.equal(
      toSquarePaymentEvent(squareEvent({}, 'payment.created'), opts)?.type,
      'payment.created'
    );
  });
  test('ignored: other events, other locations, no order, no LevelUp note', () => {
    assert.equal(toSquarePaymentEvent(squareEvent({}, 'refund.updated'), opts), null);
    assert.equal(toSquarePaymentEvent(squareEvent({ location_id: 'OTHER' }), opts), null);
    assert.equal(toSquarePaymentEvent(squareEvent({ order_id: undefined }), opts), null);
    assert.equal(toSquarePaymentEvent(squareEvent({ note: 'Walk-in sale' }), opts), null);
    assert.equal(toSquarePaymentEvent(null, opts), null);
    assert.equal(toSquarePaymentEvent({ type: 'payment.updated' }, opts), null);
  });
  test('malformed money is passed as null (the database refuses to apply it)', () => {
    const m = toSquarePaymentEvent(
      squareEvent({ amount_money: { amount: '120050', currency: 'US' } }),
      opts
    );
    assert.equal(m?.amount, null);
    assert.equal(m?.currency, null);
  });
});
