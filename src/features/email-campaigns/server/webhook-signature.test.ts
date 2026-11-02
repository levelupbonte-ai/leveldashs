// Run with `bun test` (node:test API). E-mail provider webhook signature and event mapping.
import { describe, it as test } from 'node:test';
import assert from 'node:assert/strict';
import { signWebhook, toEmailEvent, verifyWebhook, webhookSecretBytes } from './webhook-signature';

const secret = `whsec_${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}`;
const body =
  '{"type":"email.bounced","created_at":"2026-11-01T10:00:00.000Z","data":{"email_id":"4ef9a417-02e9-4d39-ad75-9611e0fcc33c","bounce":{"type":"Permanent"}}}';
const now = 1_793_000_000_000;
const ts = String(Math.floor(now / 1000));
const sig = `v1,${signWebhook('msg_1', Number(ts), body, webhookSecretBytes(secret)!)}`;

describe('webhook signature', () => {
  test('a valid signature passes', () => {
    assert.deepEqual(
      verifyWebhook(body, { id: 'msg_1', timestamp: ts, signature: `v1,bad ${sig}` }, secret, now),
      { ok: true }
    );
  });
  test('tampered body, other id, old timestamp and missing headers fail', () => {
    assert.equal(
      verifyWebhook(`${body} `, { id: 'msg_1', timestamp: ts, signature: sig }, secret, now).ok,
      false
    );
    assert.equal(
      verifyWebhook(body, { id: 'msg_2', timestamp: ts, signature: sig }, secret, now).ok,
      false
    );
    assert.deepEqual(
      verifyWebhook(body, { id: 'msg_1', timestamp: ts, signature: sig }, secret, now + 400_000),
      { ok: false, reason: 'expired' }
    );
    assert.deepEqual(
      verifyWebhook(body, { id: null, timestamp: ts, signature: sig }, secret, now),
      { ok: false, reason: 'missing' }
    );
    assert.deepEqual(
      verifyWebhook(body, { id: 'msg_1', timestamp: ts, signature: sig }, 'not-a-secret', now),
      { ok: false, reason: 'secret' }
    );
  });
});

describe('event mapping', () => {
  test('bounce with its type', () => {
    assert.deepEqual(toEmailEvent('msg_1', JSON.parse(body)), {
      id: 'msg_1',
      type: 'bounced',
      email_id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c',
      created_at: '2026-11-01T10:00:00.000Z',
      bounce_type: 'Permanent'
    });
  });
  test('opens, clicks and malformed events are ignored', () => {
    assert.equal(
      toEmailEvent('m', { type: 'email.opened', data: { email_id: '4ef9a417-02e9' } }),
      null
    );
    assert.equal(toEmailEvent('m', { type: 'email.delivered', data: { email_id: '<x>' } }), null);
    assert.equal(toEmailEvent('m', null), null);
  });
});
