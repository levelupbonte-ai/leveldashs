// Run with `bun test`. Payment event contract (docs/site-api.md), CSV export
// safety, generic form field detection, money and URL-state mappers.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from '@/lib/csv';
import { detectDataFields, displayValue, fieldLabel } from '@/features/submissions/lib/fields';
import { toSubmissionFilters } from '@/features/submissions/lib/filters';
import { toPaymentFilters } from '@/features/payments/lib/filters';
import { minorToMajor } from '@/features/payments/lib/money';
import { fillDays, percentChange } from '@/features/insights/lib/range';
import { isSiteKey, paymentEventSchema } from './site-events';

const event = {
  provider: 'stripe',
  provider_event_id: 'evt_1QabcDEF',
  provider_session_id: 'cs_live_a1B2c3',
  provider_payment_intent: null,
  status: 'paid',
  amount: 260,
  currency: 'usd',
  offer_id: 'accompagnement-voyage',
  offer_name: 'Accompagnement voyage',
  customer_email: 'Jane.Doe@Example.com',
  customer_name: 'Jane Doe',
  occurred_at: '2026-10-20T14:00:00Z',
  metadata: {}
};

describe('payment event contract', () => {
  it('accepts the documented event and normalises the email', () => {
    const parsed = paymentEventSchema.parse(event);
    assert.equal(parsed.customer_email, 'jane.doe@example.com');
  });
  it('rejects decimal, string and negative amounts', () => {
    for (const amount of [2.6, '260', -1]) {
      assert.equal(paymentEventSchema.safeParse({ ...event, amount }).success, false);
    }
  });
  it('rejects unknown statuses, uppercase currencies and bad ids', () => {
    assert.equal(paymentEventSchema.safeParse({ ...event, status: 'succeeded' }).success, false);
    assert.equal(paymentEventSchema.safeParse({ ...event, currency: 'USD' }).success, false);
    assert.equal(paymentEventSchema.safeParse({ ...event, provider_session_id: 'x' }).success, false);
    assert.equal(paymentEventSchema.safeParse({ ...event, provider_event_id: 'evt_<x>' }).success, false);
  });
  it('rejects unknown fields, HTML and bad emails', () => {
    assert.equal(paymentEventSchema.safeParse({ ...event, is_admin: true }).success, false);
    assert.equal(
      paymentEventSchema.safeParse({ ...event, customer_name: '<img src=x onerror=alert(1)>' }).success,
      false
    );
    assert.equal(paymentEventSchema.safeParse({ ...event, customer_email: 'nope' }).success, false);
  });
  it('requires an ISO date with a time zone, not in the far future', () => {
    assert.equal(paymentEventSchema.safeParse({ ...event, occurred_at: '2026-10-20' }).success, false);
    assert.equal(paymentEventSchema.safeParse({ ...event, occurred_at: '2999-01-01T00:00:00Z' }).success, false);
  });
  it('caps metadata at 8 KB', () => {
    const metadata = { blob: 'x'.repeat(9000) };
    assert.equal(paymentEventSchema.safeParse({ ...event, metadata }).success, false);
  });
  it('recognises server keys', () => {
    assert.equal(isSiteKey(`lu_live_${'a'.repeat(48)}`), true);
    assert.equal(isSiteKey(`lu_test_${'0'.repeat(48)}`), true);
    assert.equal(isSiteKey('sb_secret_abc'), false);
    assert.equal(isSiteKey(`lu_live_${'g'.repeat(48)}`), false);
  });
});

describe('csv export', () => {
  it('neutralises formulas and quotes separators', () => {
    assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
    assert.equal(csvCell('+1 514'), "'+1 514");
    assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell(null), '');
    assert.equal(toCsv(['a', 'b'], [[1, 'x\ny']]), 'a,b\r\n1,"x\ny"');
  });
});

describe('generic form fields', () => {
  it('detects data keys by frequency and skips private ones', () => {
    const rows = [
      { data: { shift: 'am', tshirt: 'M', _hp: '' } },
      { data: { shift: 'pm' } },
      { data: null }
    ];
    assert.deepEqual(detectDataFields(rows), ['shift', 'tshirt']);
  });
  it('labels and displays values as plain text', () => {
    assert.equal(fieldLabel('preferred_dateTime'), 'Preferred date time');
    assert.equal(displayValue(['a', 'b']), 'a, b');
    assert.equal(displayValue({ guests: 2 }), 'Guests: 2');
    assert.equal(displayValue(true), '✓');
    assert.equal(displayValue('<b>x</b>'), '<b>x</b>');
  });
});

describe('url state mappers', () => {
  it('maps the inbox params safely', () => {
    const f = toSubmissionFilters({ view: 'open', type: 'Bad Type', q: '  hi  ', page: -3 });
    assert.equal(f.formType, null);
    assert.equal(f.search, 'hi');
    assert.equal(f.page, 1);
    assert.equal(toSubmissionFilters({ view: 'all', type: 'volunteer_signup', q: '', page: 2 }).formType, 'volunteer_signup');
  });
  it('maps the payments params safely', () => {
    const f = toPaymentFilters({ page: 1, perPage: 999, q: '', status: [], sort: 'amount', asc: true, test: true });
    assert.equal(f.perPage, 20);
    assert.equal(f.desc, false);
    assert.equal(f.live, false);
    assert.equal(f.search, null);
  });
});

describe('money and ranges', () => {
  it('converts minor units per currency', () => {
    assert.equal(minorToMajor(260, 'usd'), 2.6);
    assert.equal(minorToMajor(500, 'jpy'), 500);
  });
  it('fills every day of the range and computes changes', () => {
    const days = fillDays('2026-10-01', '2026-10-03', [{ day: '2026-10-02', n: 4 }], (r) => ({ n: r?.n ?? 0 }));
    assert.deepEqual(days.map((d) => d.n), [0, 4, 0]);
    assert.equal(percentChange(150, 100), 50);
    assert.equal(percentChange(5, 0), null);
  });
});
