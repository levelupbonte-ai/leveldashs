import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseChecklist, parseSteps } from './parse';

describe('client portal publish parsing', () => {
  it('reads one checklist item per line, without bullets or blanks', () => {
    assert.deepEqual(parseChecklist('- Passport\n\n* Charger\n3) Visa letter\n  '), [
      'Passport',
      'Charger',
      'Visa letter'
    ]);
  });

  it('caps the checklist at 50 items of 160 characters', () => {
    const list = parseChecklist(Array.from({ length: 60 }, () => 'x'.repeat(200)).join('\n'));
    assert.equal(list.length, 50);
    assert.equal(list[0].length, 160);
  });

  it('reads itinerary steps with optional date and details', () => {
    assert.deepEqual(parseSteps('2026-12-01 Arrival — Pick-up at the airport\nCity tour'), [
      { date: '2026-12-01', title: 'Arrival', detail: 'Pick-up at the airport' },
      { date: null, title: 'City tour', detail: null }
    ]);
  });
});
