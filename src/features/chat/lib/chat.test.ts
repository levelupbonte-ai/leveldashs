// Run with `bun test` (node:test API). Chat validators: message body rules
// (same as the database), plain-text rendering with http(s) links only, the
// reply-by-email link, grouping and optimistic merge.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../api/types';
import { groupMessages, mergeMessages } from './grouping';
import { cleanMessageBody, initials, linkify, MESSAGE_MAX, replyMailto } from './message-text';

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm' + Math.random().toString(36).slice(2),
  conversation_id: 'c1',
  kind: 'message',
  sender_id: 'u1',
  sender_name: 'Alice',
  sender_avatar: null,
  body: 'hi',
  created_at: '2026-10-25T14:00:00.000Z',
  edited_at: null,
  deleted_at: null,
  client_id: null,
  mine: false,
  reply_to: null,
  ...over
});

describe('message body', () => {
  it('keeps normal text and line breaks', () => {
    assert.equal(cleanMessageBody('Hello\nteam'), 'Hello\nteam');
  });
  it('strips control, zero-width and bidi characters', () => {
    assert.equal(cleanMessageBody('a\u0007b​c‮d'), 'abcd');
  });
  it('refuses empty or whitespace-only messages', () => {
    assert.equal(cleanMessageBody(''), null);
    assert.equal(cleanMessageBody(' \n​ '), null);
  });
  it('refuses HTML tags', () => {
    assert.equal(cleanMessageBody('<script>alert(1)</script>'), null);
    assert.equal(cleanMessageBody('<img src=x onerror=alert(1)>'), null);
  });
  it('accepts comparisons that are not tags', () => {
    assert.equal(cleanMessageBody('a < b and 3 > 2'), 'a < b and 3 > 2');
  });
  it('enforces the 4000 character limit', () => {
    assert.equal(cleanMessageBody('a'.repeat(MESSAGE_MAX))?.length, MESSAGE_MAX);
    assert.equal(cleanMessageBody('a'.repeat(MESSAGE_MAX + 1)), null);
  });
});

describe('linkify', () => {
  it('turns http(s) URLs into links and leaves the rest as text', () => {
    const parts = linkify('See https://example.com/a?b=1, thanks');
    assert.deepEqual(parts, [
      { type: 'text', value: 'See ' },
      { type: 'link', value: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { type: 'text', value: ', thanks' }
    ]);
  });
  it('never links javascript:, data: or other schemes', () => {
    for (const text of [
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'ftp://example.com',
      'vbscript:x'
    ]) {
      assert.ok(
        linkify(text).every((p) => p.type === 'text'),
        text
      );
    }
  });
  it('drops trailing punctuation from links', () => {
    const link = linkify('(https://example.com).').find((p) => p.type === 'link');
    assert.equal(link?.value, 'https://example.com');
  });
  it('keeps markup as text', () => {
    assert.deepEqual(linkify('<b>x</b>'), [{ type: 'text', value: '<b>x</b>' }]);
  });
});

describe('reply by email', () => {
  it('builds an encoded mailto link', () => {
    const href = replyMailto('jane@example.com', 'Re: your message & question', 'Hi Jane,\nThanks');
    assert.equal(
      href,
      'mailto:jane@example.com?subject=Re%3A%20your%20message%20%26%20question&body=Hi%20Jane%2C%0AThanks'
    );
  });
  it('refuses header injection and invalid addresses', () => {
    assert.equal(replyMailto('jane@example.com?cc=evil@x.com', 'x'), null);
    assert.equal(replyMailto('not-an-email', 'x'), null);
    assert.equal(replyMailto(null, 'x'), null);
    const href = replyMailto('jane@example.com', 'Hello\r\nBcc: evil@x.com') ?? '';
    assert.ok(!/%0D|%0A/i.test(href.split('&body=')[0]), href);
  });
});

describe('grouping', () => {
  it('groups consecutive messages of one sender, splits by day', () => {
    const list = [
      msg({ id: 'a', created_at: '2026-10-25T14:00:00.000Z' }),
      msg({ id: 'b', created_at: '2026-10-25T14:02:00.000Z' }),
      msg({ id: 'c', created_at: '2026-10-25T14:03:00.000Z', sender_id: 'u2', sender_name: 'Bob' }),
      msg({ id: 'd', created_at: '2026-10-26T14:00:00.000Z' })
    ];
    const days = groupMessages(list, 'UTC');
    assert.equal(days.length, 2);
    assert.deepEqual(
      days[0].groups.map((g) => g.messages.map((m) => m.id)),
      [['a', 'b'], ['c']]
    );
  });
  it('starts a new group after a long gap', () => {
    const list = [
      msg({ id: 'a', created_at: '2026-10-25T14:00:00.000Z' }),
      msg({ id: 'b', created_at: '2026-10-25T14:30:00.000Z' })
    ];
    assert.equal(groupMessages(list, 'UTC')[0].groups.length, 2);
  });
  it('replaces an optimistic message by the server copy', () => {
    const pending = msg({ id: 'tmp', client_id: 'k1', pending: 'sending', mine: true });
    const merged = mergeMessages(
      [msg({ id: 'x' }), pending],
      [msg({ id: 'srv', client_id: 'k1', mine: true, created_at: '2026-10-25T14:01:00.000Z' })]
    );
    assert.deepEqual(
      merged.map((m) => m.id),
      ['x', 'srv']
    );
  });
});

describe('initials', () => {
  it('uses the first and last word', () => {
    assert.equal(initials('Jane van Doe'), 'JD');
    assert.equal(initials(''), '?');
    assert.equal(initials('élodie'), 'É');
  });
});
