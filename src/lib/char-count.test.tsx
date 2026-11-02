// Run with `bun test`. The shared character counter of the form fields:
// thresholds (amber near the limit, red past it), which inputs get one, and
// the rendered text ("42 / 160", screen-reader sentence, tone).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { CharCounter } from '@/components/forms/char-counter';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import { charCountTone, isCountedType } from './char-count';

describe('character counter tone', () => {
  it('stays muted far from the limit', () => {
    assert.equal(charCountTone(0, 160), 'normal');
    assert.equal(charCountTone(149, 160), 'normal');
  });
  it('turns amber at 90 % of the limit, or 10 characters left on long fields', () => {
    assert.equal(charCountTone(150, 160), 'near');
    assert.equal(charCountTone(160, 160), 'near');
    assert.equal(charCountTone(3990, 4000), 'near');
    assert.equal(charCountTone(3989, 4000), 'normal');
    assert.equal(charCountTone(54, 60), 'near');
    assert.equal(charCountTone(53, 60), 'normal');
  });
  it('turns red past the limit', () => {
    assert.equal(charCountTone(161, 160), 'over');
    assert.equal(charCountTone(64, 60), 'over');
  });
  it('ignores a missing limit', () => {
    assert.equal(charCountTone(10, 0), 'normal');
  });
});

describe('counted inputs', () => {
  it('counts free text only', () => {
    for (const type of [undefined, 'text', 'search']) assert.equal(isCountedType(type), true);
    for (const type of ['email', 'url', 'tel', 'password', 'number', 'date']) {
      assert.equal(isCountedType(type), false, type);
    }
  });
});

const render = (count: number, max: number, locale: 'en' | 'fr' = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      timeZone='America/Toronto'
      messages={locale === 'en' ? en : fr}
    >
      <CharCounter id='c' count={count} max={max} />
    </NextIntlClientProvider>
  );

describe('CharCounter', () => {
  it('shows "count / max" and a sentence for screen readers', () => {
    const html = render(42, 160);
    assert.match(html, /42 \/ 160/);
    assert.match(html, /42 of 160 characters used/);
    assert.match(html, /data-tone="normal"/);
    assert.match(html, /aria-live="off"/);
  });
  it('is amber near the limit and red past it, and announces it', () => {
    const near = render(150, 160);
    assert.match(near, /data-tone="near"/);
    assert.match(near, /text-amber-700/);
    assert.match(near, /aria-live="polite"/);
    const over = render(170, 160);
    assert.match(over, /data-tone="over"/);
    assert.match(over, /text-destructive/);
  });
  it('is translated', () => {
    assert.match(render(5, 60, 'fr'), /5 caractères utilisés sur 60/);
  });
});

describe('messages', () => {
  it('every message is valid ICU (no stray braces)', async () => {
    const { IntlMessageFormat } = await import('intl-messageformat');
    for (const [locale, messages] of [
      ['en', en],
      ['fr', fr]
    ] as const) {
      const walk = (node: unknown, path: string) => {
        if (typeof node === 'string') {
          assert.doesNotThrow(
            () => new IntlMessageFormat(node, locale, undefined, { ignoreTag: true }),
            `${locale}:${path}`
          );
        } else if (node && typeof node === 'object') {
          for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
        }
      };
      walk(messages, '');
    }
  });
});
