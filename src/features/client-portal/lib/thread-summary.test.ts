import assert from 'node:assert/strict';
import { describe, it as test } from 'node:test';
import { parseThreadSummary } from './thread-summary';

describe('AI summary of a member conversation', () => {
  test('reads the JSON answer, even inside a code block', () => {
    const s = parseThreadSummary(
      '```json\n{"need":"Refaire son dossier","summary":"Il a payé.  Le formulaire a échoué.","urgency":"high","next":"Lui envoyer le lien"}\n```'
    );
    assert.deepEqual(s, {
      need: 'Refaire son dossier',
      summary: 'Il a payé. Le formulaire a échoué.',
      urgency: 'high',
      next: 'Lui envoyer le lien'
    });
  });

  test('unknown urgency becomes normal; missing need or summary is refused', () => {
    assert.equal(
      parseThreadSummary('{"need":"x","summary":"y","urgency":"panic"}')?.urgency,
      'normal'
    );
    assert.equal(parseThreadSummary('{"summary":"y"}'), null);
    assert.equal(parseThreadSummary('not json'), null);
  });

  test('long texts are clipped', () => {
    const s = parseThreadSummary(
      JSON.stringify({ need: 'n'.repeat(500), summary: 's'.repeat(2000) })
    );
    assert.equal(s?.need.length, 140);
    assert.equal(s?.summary.length, 600);
  });
});
