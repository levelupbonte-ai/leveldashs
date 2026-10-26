// Run with `bun test` (node:test API). Plan limit errors and the billing number helpers.
import { describe, it as test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanLimitError, parsePlanLimit, planLimitFromDb } from '@/lib/plan-limit';
import { majorToMinor, meterPercent, meterState, minorToField, storageParts } from './format';

describe('plan limit errors', () => {
  test('database detail becomes the key and the limit', () => {
    const info = planLimitFromDb({
      message: 'plan_limit_reached',
      code: 'PT402',
      details: '{"key": "team_members", "limit": 3, "plan": "free"}'
    });
    assert.deepEqual(info, { key: 'team_members', limit: 3 });
  });

  test('other errors and malformed details are not plan limits', () => {
    assert.equal(planLimitFromDb({ message: 'forbidden', code: 'PT403' }), null);
    assert.equal(planLimitFromDb({ message: 'plan_limit_reached', details: 'nope' }), null);
    assert.equal(parsePlanLimit({ key: 'unknown', limit: 1 }), null);
    assert.equal(parsePlanLimit({ key: 'websites', limit: -1 }), null);
    assert.equal(parsePlanLimit({ key: 'websites', limit: 1.5 }), null);
    assert.equal(parsePlanLimit(null), null);
  });

  test('PlanLimitError carries the AppError code', () => {
    const e = new PlanLimitError({ key: 'assistant_requests_month', limit: 50 });
    assert.equal(e.code, 'planLimitReached');
    assert.equal(e.info.limit, 50);
  });
});

describe('money and meters', () => {
  test('major amounts to minor units and back', () => {
    assert.equal(majorToMinor(19.99, 'usd'), 1999);
    assert.equal(majorToMinor('49,5', 'eur'), 4950);
    assert.equal(majorToMinor(500, 'jpy'), 500);
    assert.equal(majorToMinor('', 'usd'), null);
    assert.equal(majorToMinor(undefined, 'usd'), null);
    assert.equal(majorToMinor('abc', 'usd'), null);
    assert.equal(minorToField(1999, 'usd'), 19.99);
    assert.equal(minorToField(null, 'usd'), undefined);
  });

  test('storage shown in MB below 1 GB, GB above', () => {
    assert.deepEqual(storageParts(1791358), { value: 1.7, unit: 'MB' });
    assert.deepEqual(storageParts(3 * 1024 * 1048576), { value: 3, unit: 'GB' });
    assert.deepEqual(storageParts(0), { value: 0, unit: 'MB' });
  });

  test('meter states: ok, near (80%), reached; unlimited is always ok', () => {
    assert.equal(meterState(1, 3), 'ok');
    assert.equal(meterState(4, 5), 'near');
    assert.equal(meterState(5, 5), 'reached');
    assert.equal(meterState(6, 5), 'reached');
    assert.equal(meterState(0, 0), 'reached');
    assert.equal(meterState(999, null), 'ok');
    assert.equal(meterPercent(12, 50), 24);
    assert.equal(meterPercent(80, 50), 100);
    assert.equal(meterPercent(5, null), 0);
  });
});
