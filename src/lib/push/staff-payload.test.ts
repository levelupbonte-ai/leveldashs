import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVapid, staffPushPayload, type StaffPushRow } from './staff-payload';

const row: StaffPushRow = {
  device: 1,
  endpoint: 'https://push.example/abc',
  p256dh: 'x'.repeat(60),
  auth: 'y'.repeat(16),
  locale: 'fr',
  kind: 'message',
  website_id: 'ws_1',
  website: 'Black Pater',
  name: 'Awa',
  event: 9
};

describe('staff push', () => {
  it('a message opens the unread folder and never carries the message', () => {
    const p = staffPushPayload(row);
    assert.equal(p.title, 'Nouveau message · Black Pater');
    assert.equal(p.body, 'Awa vous a écrit.');
    assert.equal(p.url, '/dashboard/site/client-portal?folder=unread');
  });

  it('a new member in English, without a name', () => {
    const p = staffPushPayload({ ...row, kind: 'member', locale: 'en', name: null });
    assert.equal(p.title, 'New member · Black Pater');
    assert.equal(p.body, 'Someone joined your client space.');
    assert.equal(p.url, '/dashboard/site/client-portal?tab=customers');
  });

  it('no valid VAPID keys: notifications are off', () => {
    assert.equal(readVapid({}), null);
    assert.equal(
      readVapid({ DASHBOARD_VAPID_PUBLIC_KEY: 'short', DASHBOARD_VAPID_PRIVATE_KEY: 'short' }),
      null
    );
    const key = 'B'.repeat(87);
    assert.deepEqual(
      readVapid({
        DASHBOARD_VAPID_PUBLIC_KEY: ` ${key} `,
        DASHBOARD_VAPID_PRIVATE_KEY: 'p'.repeat(43)
      }),
      { publicKey: key, privateKey: 'p'.repeat(43) }
    );
  });
});
