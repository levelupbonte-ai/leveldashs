// Run with `bun test` (node:test API). LevelUp forms: field ids and value checks.
import { describe, it as test } from 'node:test';
import assert from 'node:assert/strict';
import type { FormField } from '../api/types';
import { fieldIdFrom, toPayload, validateValues } from './fields';

const fields: FormField[] = [
  { id: 'name', type: 'text', label: 'Name', required: true, maps: 'name' },
  { id: 'email', type: 'email', label: 'E-mail', required: true, maps: 'email' },
  { id: 'guests', type: 'number', label: 'Guests' },
  { id: 'terms', type: 'checkbox', label: 'Terms', required: true },
  { id: 'topics', type: 'multiselect', label: 'Topics', options: ['A', 'B'] }
];

describe('form fields', () => {
  test('ids come from the label, without accents, and never repeat', () => {
    assert.equal(fieldIdFrom('Date souhaitée', []), 'date_souhaitee');
    assert.equal(fieldIdFrom('Date souhaitée', ['date_souhaitee']), 'date_souhaitee_2');
    assert.equal(fieldIdFrom('123 !!!', []), 'field');
  });

  test('required, e-mail and checkbox rules match the server', () => {
    assert.deepEqual(validateValues(fields, {}), {
      name: 'required',
      email: 'required',
      terms: 'required'
    });
    assert.deepEqual(validateValues(fields, { name: 'Ana', email: 'nope', terms: true }), {
      email: 'email'
    });
    assert.deepEqual(
      validateValues(fields, { name: 'Ana', email: 'ana@example.com', terms: true, guests: 'x' }),
      {
        guests: 'number'
      }
    );
  });

  test('the payload has numbers as numbers and leaves empty answers out', () => {
    assert.deepEqual(
      toPayload(fields, {
        name: ' Ana ',
        email: 'ana@example.com',
        guests: '4',
        terms: true,
        topics: []
      }),
      { name: 'Ana', email: 'ana@example.com', guests: 4, terms: true }
    );
  });

  test('links, times, ratings and files follow the same rules as the server', () => {
    const more: FormField[] = [
      { id: 'intro', type: 'section', label: 'About you' },
      { id: 'site', type: 'url', label: 'Site' },
      { id: 'at', type: 'time', label: 'Time' },
      { id: 'stars', type: 'rating', label: 'Rating', max: 5, required: true },
      { id: 'cv', type: 'file', label: 'CV', max_files: 2 }
    ];
    assert.deepEqual(validateValues(more, { site: 'nope', at: '25:00', stars: 7 }), {
      site: 'url',
      at: 'time',
      stars: 'rating'
    });
    assert.deepEqual(
      toPayload(more, {
        site: 'https://a.example.com',
        at: '09:30',
        stars: 4,
        cv: [{ path: 'abc/def.pdf', name: 'cv.pdf', preview: null }]
      }),
      { site: 'https://a.example.com', at: '09:30', stars: 4, cv: ['abc/def.pdf'] }
    );
  });
});
