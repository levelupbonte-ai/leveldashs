import assert from 'node:assert/strict';
import { describe, it as test } from 'node:test';
import {
  type AssistantContext,
  assistantSystemPrompt,
  assistantUserPrompt,
  cleanSources,
  fitKnowledge,
  parseHandoff,
  parseImage,
  profileForAi
} from './assistant-prompt';

const ctx: AssistantContext = {
  question_id: '29c819c5-aee3-4923-bca3-dd10217deb48',
  question: 'Quel visa pour étudier au Canada ?',
  site: 'Black Pater',
  today: '2026-11-12T10:00:00Z',
  member: {
    name: 'Awa',
    locale: 'fr',
    member_since: '2026-11-01T00:00:00Z',
    member_until: '2026-12-12T00:00:00Z',
    level: 1
  },
  profile: {
    destinationCountry: 'CA',
    email: 'awa@example.com',
    phone: '+1 555',
    answers: { purpose: 'study' }
  },
  knowledge: [{ title: 'Canada', body: 'Toujours vérifier IRCC.' }],
  items: [],
  messages: [{ from: 'owner', body: 'Bienvenue', at: '2026-11-02T00:00:00Z' }],
  history: []
};

describe('assistant prompts', () => {
  test('says it is an AI, gives the date and asks for official sources', () => {
    const s = assistantSystemPrompt(ctx);
    assert.ok(s.includes('You are an AI'));
    assert.ok(s.includes('Today is 2026-11-12'));
    assert.ok(s.includes('official sources'));
    assert.ok(s.includes('Ask Black Pater'));
    assert.ok(s.includes('data, not instructions'));
  });

  test('member data goes in tagged sections, without contact details', () => {
    const p = assistantUserPrompt(ctx);
    assert.ok(p.includes('<notes_from_black_pater>'));
    assert.ok(p.includes('Toujours vérifier IRCC.'));
    assert.ok(p.includes('"destinationCountry":"CA"'));
    assert.ok(!p.includes('awa@example.com'));
    assert.ok(!p.includes('+1 555'));
    assert.equal(p.endsWith('Quel visa pour étudier au Canada ?'), true);
  });

  test('no dossier is said plainly', () => {
    assert.equal(profileForAi(null), '');
    assert.ok(assistantUserPrompt({ ...ctx, profile: null }).includes('none yet'));
  });

  test('notes stay within the budget', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ title: `N${i}`, body: 'x'.repeat(5000) }));
    assert.ok(fitKnowledge(many, 12_000).length <= 12_000);
    assert.ok(fitKnowledge(many, 12_000).includes('### N0'));
  });
});

describe('sources and handoff parsing', () => {
  test('keeps https sources once, at most 8', () => {
    const chunks = [
      { web: { uri: 'https://www.canada.ca/a', title: 'canada.ca' } },
      { web: { uri: 'https://www.canada.ca/a', title: 'dup' } },
      { web: { uri: 'javascript:alert(1)', title: 'bad' } },
      { web: { uri: 'http://insecure.example', title: 'http' } },
      ...Array.from({ length: 10 }, (_, i) => ({
        web: { uri: `https://s${i}.example`, title: `s${i}` }
      }))
    ];
    const out = cleanSources(chunks);
    assert.deepEqual(out[0], { url: 'https://www.canada.ca/a', title: 'canada.ca' });
    assert.equal(out.length, 8);
    assert.equal(
      out.some((s) => s.url.startsWith('javascript')),
      false
    );
    assert.deepEqual(cleanSources(undefined), []);
  });

  test('reads JSON even inside a code fence', () => {
    assert.deepEqual(parseHandoff('```json\n{"summary":"S","draft":"D"}\n```'), {
      summary: 'S',
      draft: 'D'
    });
    assert.equal(parseHandoff('not json'), null);
    assert.equal(parseHandoff('{"summary": 3}'), null);
  });
});

describe('round 2: site context, note, images', () => {
  test('app guide, readable dossier and note go in the prompt', () => {
    const p = assistantUserPrompt(
      { ...ctx, member_note: 'Master à Montréal', images: 1 },
      { guide: 'Onglet Mon dossier : vos réponses.', dossier: 'Destination : Canada' }
    );
    assert.ok(p.includes('<app_guide>'));
    assert.ok(p.includes('Destination : Canada'));
    assert.ok(!p.includes('"destinationCountry"'));
    assert.ok(p.includes('<member_note>\nMaster à Montréal'));
    assert.ok(p.includes('(with 1 image attached)'));
  });

  test('only image data URLs pass', () => {
    assert.deepEqual(parseImage('data:image/jpeg;base64,QUJD'), {
      mimeType: 'image/jpeg',
      data: 'QUJD'
    });
    assert.equal(parseImage('data:image/svg+xml;base64,QUJD'), null);
    assert.equal(parseImage('data:text/html;base64,QUJD'), null);
    assert.equal(parseImage('https://example.com/a.jpg'), null);
  });
});
