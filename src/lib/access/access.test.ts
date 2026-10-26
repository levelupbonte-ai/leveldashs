// Run with `bun test` (node:test API). Access flows: host matching for staff
// review hints, activation codes, invitation links (shared hash vectors with the
// SQL suites in supabase/tests).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVATION_CODE_BITS,
  ACTIVATION_CODE_PATTERN,
  CROCKFORD_ALPHABET,
  activationCodeStatus,
  emailsMatch,
  formatActivationCode,
  invitationState,
  inviteTokenFromNext,
  isAccessFlowPath,
  isInviteToken,
  normalizeActivationCode
} from './codes';
import { clientFingerprint, sha256Hex } from './hash';
import {
  emailDomain,
  nameSimilarity,
  normalizeHost,
  normalizeName,
  suggestSites,
  websiteHosts
} from './host-match';

const NOW = new Date('2026-10-25T12:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe('host matching (review hints)', () => {
  it('normalises scheme, www, case, port, path, credentials and trailing dots', () => {
    assert.equal(normalizeHost('https://blackpater.com/'), 'blackpater.com');
    assert.equal(normalizeHost('https://www.BlackPater.com/about?x=1#top'), 'blackpater.com');
    assert.equal(normalizeHost('blackpater.com'), 'blackpater.com');
    assert.equal(normalizeHost('www.blackpater.com.'), 'blackpater.com');
    assert.equal(normalizeHost('http://user:pass@www.x.co:8080/a'), 'x.co');
    assert.equal(normalizeHost('https://evil.com\\@blackpater.com'), 'evil.com');
  });

  it('refuses things that are not domains', () => {
    for (const v of ['', null, 'not a url', 'javascript:alert(1)', 'localhost', '<b>x</b>.com']) {
      assert.equal(normalizeHost(v as string | null), null, String(v));
    }
  });

  it('reads e-mail domains and website hosts the same way', () => {
    assert.equal(emailDomain('Owner@WWW.BlackPater.com'), 'blackpater.com');
    assert.equal(emailDomain('no-at-sign'), null);
    assert.deepEqual(
      websiteHosts('blackpater.com', ['https://blackpater.com', 'https://www.blackpater.com']),
      ['blackpater.com']
    );
  });

  it('scores similar business names', () => {
    assert.equal(normalizeName('Black_pater'), 'blackpater');
    assert.equal(nameSimilarity('Black_pater', 'Black Pater'), 1);
    assert.equal(nameSimilarity('Café Élan', 'cafe elan'), 1);
    assert.ok(nameSimilarity('Final Stop Barber', 'Final Stop Barber Shop & Salon') >= 0.75);
    assert.ok(nameSimilarity('moni', 'LevelUp Ecosystem') < 0.5);
    assert.equal(nameSimilarity('a', 'a'), 0);
  });

  it('suggests the Black Pater site first and never an unrelated one', () => {
    const sites = [
      {
        id: 'ws_6e797257f5b32b86',
        name: 'LevelUp Ecosystem',
        primaryDomain: 'levelup-ecosystem.com',
        hosts: [],
        organizationName: 'LevelUp Ecosystem'
      },
      {
        id: 'ws_ab9493c5857ed460',
        name: 'Black Pater',
        primaryDomain: 'blackpater.com',
        hosts: ['blackpater.com'],
        organizationName: 'Black Pater'
      },
      {
        id: 'ws_d5e600b7dc2ec9a9',
        name: 'Final Stop',
        primaryDomain: 'finalstop.org',
        hosts: [],
        organizationName: 'Final Stop Barber Shop & Salon'
      }
    ];
    const matches = suggestSites(
      { website: 'https://blackpater.com/', email: 'jp@gmail.com', businessName: 'Black_pater' },
      sites
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].site.id, 'ws_ab9493c5857ed460');
    assert.equal(matches[0].hostMatch, true);
    assert.equal(matches[0].emailMatch, false);
    assert.equal(
      suggestSites({ website: null, email: 'x@y.io', businessName: 'moni' }, sites).length,
      0
    );
  });
});

describe('activation codes', () => {
  it('60 bits from 12 Crockford base32 symbols without I, L, O, U', () => {
    assert.equal(CROCKFORD_ALPHABET.length, 32);
    assert.equal(new Set(CROCKFORD_ALPHABET).size, 32);
    assert.ok(!/[ILOU]/.test(CROCKFORD_ALPHABET));
    assert.ok(ACTIVATION_CODE_BITS >= 60);
  });

  it('normalises what people type (case, separators, prefix, O/I/L)', () => {
    assert.equal(normalizeActivationCode('LVL-ABCD-EFGH-1234'), 'ABCDEFGH1234');
    assert.equal(normalizeActivationCode(' lvl abcd-efgh_1234 '), 'ABCDEFGH1234');
    assert.equal(normalizeActivationCode('abcdefgh1234'), 'ABCDEFGH1234');
    assert.equal(normalizeActivationCode('LVL-OOOO-IIII-LLLL'), '000011111111');
    assert.equal(formatActivationCode('ABCDEFGH1234'), 'LVL-ABCD-EFGH-1234');
    assert.ok(ACTIVATION_CODE_PATTERN.test('LVL-ABCD-EFGH-1234'));
  });

  it('refuses anything else, including a website id', () => {
    for (const v of [
      '',
      'LVL-ABCD',
      'LVL-UUUU-AAAA-BBBB',
      'ws_ab9493c5857ed460',
      'LVL-ABCD-EFGH-12345',
      '<script>'
    ]) {
      assert.equal(normalizeActivationCode(v), null, v);
    }
  });

  it('hashes like the database (shared vector)', () => {
    assert.equal(
      sha256Hex('ABCDEFGH1234'),
      'ef8d2f565d2fb9dbd5afd366b69dc5c3c73b28fb434e1704a6660e9b61c648c3'
    );
    assert.equal(
      sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('status: used and revoked win over expiry; expiry at the exact instant', () => {
    assert.equal(
      activationCodeStatus(
        { usedAt: NOW.toISOString(), revokedAt: null, expiresAt: later(-1) },
        NOW
      ),
      'used'
    );
    assert.equal(
      activationCodeStatus(
        { usedAt: null, revokedAt: NOW.toISOString(), expiresAt: later(1000) },
        NOW
      ),
      'revoked'
    );
    assert.equal(
      activationCodeStatus({ usedAt: null, revokedAt: null, expiresAt: NOW.toISOString() }, NOW),
      'expired'
    );
    assert.equal(
      activationCodeStatus({ usedAt: null, revokedAt: null, expiresAt: later(1) }, NOW),
      'active'
    );
  });
});

describe('invitation links', () => {
  it('tokens are 43 base64url characters', () => {
    assert.ok(isInviteToken('A'.repeat(43)));
    assert.ok(isInviteToken('abc_DEF-123'.padEnd(43, 'x')));
    assert.ok(!isInviteToken('A'.repeat(42)));
    assert.ok(!isInviteToken('A'.repeat(42) + '='));
    assert.ok(!isInviteToken(null));
  });

  it('expiry, single use and revocation', () => {
    const base = {
      acceptedAt: null,
      revokedAt: null,
      usedAt: null,
      expiresAt: later(7 * 86400000)
    };
    assert.equal(invitationState(base, NOW), 'valid');
    assert.equal(invitationState({ ...base, expiresAt: later(-1) }, NOW), 'expired');
    assert.equal(invitationState({ ...base, usedAt: NOW.toISOString() }, NOW), 'used');
    assert.equal(invitationState({ ...base, revokedAt: NOW.toISOString() }, NOW), 'revoked');
    assert.equal(
      invitationState({ ...base, acceptedAt: NOW.toISOString(), expiresAt: later(-1) }, NOW),
      'accepted'
    );
  });

  it('e-mail must match exactly (case and spaces aside)', () => {
    assert.ok(emailsMatch('Invitee@Example.com ', 'invitee@example.com'));
    assert.ok(!emailsMatch('invitee@example.com', 'invitee@example.co'));
    assert.ok(!emailsMatch('xinvitee@example.com', 'invitee@example.com'));
    assert.ok(!emailsMatch(null, 'invitee@example.com'));
  });

  it('reads the token from a next path only for the accept page', () => {
    const token = 'T'.repeat(43);
    assert.equal(inviteTokenFromNext(`/auth/accept-invite?token=${token}`), token);
    assert.equal(inviteTokenFromNext(`/dashboard?token=${token}`), null);
    assert.equal(inviteTokenFromNext('/auth/accept-invite?token=short'), null);
    assert.ok(isAccessFlowPath('/auth/activate'));
    assert.ok(!isAccessFlowPath('/dashboard/site'));
  });

  it('client fingerprint is a hash of the first forwarded IP, never the IP', () => {
    const fp = clientFingerprint(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }));
    assert.match(fp ?? '', /^[0-9a-f]{64}$/);
    assert.equal(fp, sha256Hex('client:203.0.113.7'));
    assert.equal(clientFingerprint(new Headers({ 'x-forwarded-for': 'not an ip' })), null);
    assert.equal(clientFingerprint(new Headers()), null);
  });
});
