// Run with `bun test` (node:test API). PayPal: config, order body, amounts,
// captures read back from PayPal, webhook payloads.
import { describe, it as test } from 'node:test';
import assert from 'node:assert/strict';
import { readOnlinePaymentsConfig } from './config';
import {
  approveUrl,
  captureOfOrder,
  captureOfWebhook,
  fromPayPalValue,
  orderBody,
  orderIdOf,
  orderStatus,
  sessionIdOf,
  toPayPalPaymentEvent,
  toPayPalValue
} from './paypal-form';

const BILLING = 'lu_bill_' + '0123456789abcdef'.repeat(3);
const PAYPAL = {
  LEVELUP_PAYPAL_CLIENT_ID: 'A'.repeat(40),
  LEVELUP_PAYPAL_CLIENT_SECRET: 'E'.repeat(40),
  LEVELUP_PAYPAL_WEBHOOK_ID: '8PT597110X687430LKGECATA',
  LEVELUP_PAYPAL_ENV: 'sandbox'
};
const SQUARE = {
  LEVELUP_SQUARE_ACCESS_TOKEN: 'EAAA' + 'x'.repeat(40),
  LEVELUP_SQUARE_LOCATION_ID: 'L8A2BC3D4E5F6',
  LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY: 'k'.repeat(22),
  LEVELUP_SQUARE_ENV: 'production'
};
const ON = { LEVELUP_ONLINE_PAYMENTS: 'on', LEVELUP_BILLING_KEY: BILLING };
const CHARGE = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('PayPal config', () => {
  test('PayPal alone: on, PayPal is the only method', () => {
    const c = readOnlinePaymentsConfig({ ...ON, ...PAYPAL });
    assert.ok(c);
    assert.deepEqual(c.methods, ['paypal']);
    assert.equal(c.provider, 'paypal');
    assert.equal(c.cardProvider, null);
  });
  test('Square + PayPal: card first, then PayPal', () => {
    const c = readOnlinePaymentsConfig({ ...ON, ...SQUARE, ...PAYPAL });
    assert.ok(c);
    assert.deepEqual(c.methods, ['card', 'paypal']);
    assert.equal(c.cardProvider, 'square');
    assert.equal(c.provider, 'square');
  });
  test('incomplete PayPal keys keep PayPal off', () => {
    for (const key of Object.keys(PAYPAL)) {
      assert.equal(readOnlinePaymentsConfig({ ...ON, ...PAYPAL, [key]: '' }), null, key);
    }
    const c = readOnlinePaymentsConfig({ ...ON, ...SQUARE, ...PAYPAL, LEVELUP_PAYPAL_ENV: 'live' });
    assert.deepEqual(c?.methods, ['card']);
  });
  test('LEVELUP_PAYMENT_PROVIDER=paypal: PayPal only, even with card keys', () => {
    const c = readOnlinePaymentsConfig({
      ...ON,
      ...SQUARE,
      ...PAYPAL,
      LEVELUP_PAYMENT_PROVIDER: 'paypal'
    });
    assert.deepEqual(c?.methods, ['paypal']);
    assert.equal(
      readOnlinePaymentsConfig({ ...ON, ...SQUARE, LEVELUP_PAYMENT_PROVIDER: 'paypal' }),
      null
    );
  });
});

describe('PayPal amounts and ids', () => {
  test('minor units both ways', () => {
    assert.equal(toPayPalValue(1500, 'usd'), '15.00');
    assert.equal(toPayPalValue(1005, 'eur'), '10.05');
    assert.equal(toPayPalValue(7, 'usd'), '0.07');
    assert.equal(toPayPalValue(1500, 'jpy'), '1500');
    assert.equal(fromPayPalValue('15.00', 'USD'), 1500);
    assert.equal(fromPayPalValue('10.5', 'USD'), 1050);
    assert.equal(fromPayPalValue('1500', 'JPY'), 1500);
    assert.equal(fromPayPalValue('1.5e3', 'USD'), null);
    assert.equal(fromPayPalValue(15, 'USD'), null);
    assert.throws(() => toPayPalValue(-1, 'usd'));
  });
  test('session ids carry the provider', () => {
    assert.equal(sessionIdOf('5O190127TN364715T'), 'pp_5O190127TN364715T');
    assert.equal(orderIdOf('pp_5O190127TN364715T'), '5O190127TN364715T');
    assert.equal(orderIdOf('cs_test_abc'), null);
    assert.equal(orderIdOf('pp_../x'), null);
  });
});

describe('PayPal orders', () => {
  const request = {
    chargeId: CHARGE,
    organizationId: '00000000-0000-4000-8000-000000000000',
    invoiceNumber: 'LU-2026-0007',
    description: 'LU-2026-0007 · Website setup',
    amount: 15000,
    currency: 'usd',
    idempotencyKey: `levelup-charge-${CHARGE}-1`,
    expiresAt: new Date('2026-11-12T12:00:00Z'),
    successUrl: 'https://dashboard.levelup-ecosystem.com/api/billing/paypal/return',
    cancelUrl: 'https://dashboard.levelup-ecosystem.com/dashboard/billing?payment=cancelled'
  };
  test('the order: exact amount, charge id, invoice number, no shipping', () => {
    const body = orderBody(request, request.successUrl);
    assert.equal(body.intent, 'CAPTURE');
    assert.deepEqual(body.purchase_units[0].amount, { currency_code: 'USD', value: '150.00' });
    assert.equal(body.purchase_units[0].custom_id, CHARGE);
    assert.equal(body.purchase_units[0].invoice_id, 'LU-2026-0007');
    assert.equal(body.payment_source.paypal.experience_context.shipping_preference, 'NO_SHIPPING');
    assert.equal(body.payment_source.paypal.experience_context.return_url, request.successUrl);
    assert.deepEqual(orderBody(request, request.successUrl), body);
  });
  test('approval link only on paypal.com', () => {
    assert.equal(
      approveUrl({
        links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=X' }]
      }),
      'https://www.sandbox.paypal.com/checkoutnow?token=X'
    );
    assert.equal(
      approveUrl({ links: [{ rel: 'payer-action', href: 'https://evil.example/x' }] }),
      null
    );
    assert.equal(orderStatus('APPROVED'), 'open');
    assert.equal(orderStatus('COMPLETED'), 'complete');
    assert.equal(orderStatus('VOIDED'), 'expired');
  });
  test('capture read from the captured order', () => {
    const order = {
      id: '5O190127TN364715T',
      status: 'COMPLETED',
      purchase_units: [
        {
          custom_id: CHARGE,
          payments: {
            captures: [
              {
                id: '3C679366HH908993F',
                status: 'COMPLETED',
                amount: { currency_code: 'USD', value: '150.00' }
              }
            ]
          }
        }
      ]
    };
    const c = captureOfOrder(order);
    assert.deepEqual(c, {
      orderId: '5O190127TN364715T',
      captureId: '3C679366HH908993F',
      status: 'COMPLETED',
      amount: 15000,
      currency: 'usd',
      chargeId: CHARGE
    });
    assert.deepEqual(
      toPayPalPaymentEvent(c!, { eventId: 'CAP-3C679366HH908993F', livemode: false }),
      {
        provider: 'paypal',
        event_id: 'CAP-3C679366HH908993F',
        type: 'PAYMENT.CAPTURE.COMPLETED',
        order_id: '5O190127TN364715T',
        capture_id: '3C679366HH908993F',
        charge_id: CHARGE,
        amount: 15000,
        currency: 'usd',
        payment_status: 'COMPLETED',
        livemode: false
      }
    );
    assert.equal(captureOfOrder({ id: '5O190127TN364715T', purchase_units: [{}] }), null);
  });
  test('webhook capture: needs the related order and a handled event', () => {
    const event = {
      id: 'WH-58D329510W468432D-8HN650336L201105X',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: '3C679366HH908993F',
        status: 'COMPLETED',
        amount: { currency_code: 'USD', value: '150.00' },
        custom_id: CHARGE,
        supplementary_data: { related_ids: { order_id: '5O190127TN364715T' } }
      }
    };
    const c = captureOfWebhook(event);
    assert.equal(c?.orderId, '5O190127TN364715T');
    assert.equal(c?.eventId, 'WH-58D329510W468432D-8HN650336L201105X');
    assert.equal(c?.amount, 15000);
    assert.equal(captureOfWebhook({ ...event, event_type: 'PAYMENT.CAPTURE.REVERSED' }), null);
    assert.equal(
      captureOfWebhook({ ...event, resource: { ...event.resource, supplementary_data: {} } }),
      null
    );
  });
});
