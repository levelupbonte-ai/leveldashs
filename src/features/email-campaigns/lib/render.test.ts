// Run with `bun test` (node:test API). Campaign e-mail rendering, footer and unsubscribe headers.
import { describe, it as test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_TEMPLATES,
  CampaignRenderError,
  bodyText,
  brandColor,
  fromHeader,
  mediaPublicUrl,
  renderCampaign,
  resolveLogoUrl,
  textOn,
  unsubscribeHeaders,
  unsubscribeUrls,
  type CampaignBrand,
  type CampaignContent
} from './render';
import { parseContactsCsv } from './csv-import';

const brand: CampaignBrand = {
  businessName: 'Final Stop Barber Shop',
  siteName: 'Final Stop',
  siteDomain: 'finalstop.org',
  logoUrl: 'https://finalstop.org/logo.png',
  brandColor: '#1d4ed8',
  postalAddress: '1234 Market Street\nSan Diego, CA 92101'
};
const labels = {
  reason: 'You’re receiving this because you subscribed on Final Stop.',
  unsubscribe: 'Unsubscribe',
  addressMissing: 'Add your postal address'
};
const content: CampaignContent = {
  template: 'newsletter',
  locale: 'en',
  subject: 'Autumn news',
  previewText: 'New hours',
  heading: 'Hello',
  body: 'First line\nsecond line\n\n**Bold** and [our site](https://finalstop.org/book).',
  buttonLabel: 'Book now',
  buttonUrl: 'https://finalstop.org/book',
  imageUrl: null
};
const URL_ = 'https://dashboard.levelup-ecosystem.com/unsubscribe/tok?c=1';

describe('campaign rendering escapes everything', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
  test('heading, body, subject, preview, button label and business name are escaped', () => {
    const { html } = renderCampaign(
      {
        ...content,
        subject: evil,
        previewText: evil,
        heading: evil,
        body: `${evil}\n\n**${evil}**`,
        buttonLabel: evil
      },
      { ...brand, businessName: evil, postalAddress: evil },
      { ...labels, reason: evil },
      { unsubscribeUrl: URL_ }
    );
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!/onerror=alert/.test(html.replace(/onerror=alert\(2\)&gt;/g, '')));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('&quot;&#39;&amp;'));
  });

  test('only http(s) links become links; javascript: stays text', () => {
    const { html } = renderCampaign(
      { ...content, body: '[click](javascript:alert(1)) [ok](https://example.com/a?b=1&c=2)' },
      brand,
      labels,
      { unsubscribeUrl: URL_ }
    );
    assert.ok(!html.includes('javascript:'));
    assert.ok(html.includes('href="https://example.com/a?b=1&amp;c=2"'));
    assert.ok(html.includes('click'));
  });

  test('a javascript: or data: button is dropped', () => {
    for (const buttonUrl of ['javascript:alert(1)', 'data:text/html,<b>x</b>', '//evil.example']) {
      const { html } = renderCampaign({ ...content, buttonUrl }, brand, labels, {
        unsubscribeUrl: URL_
      });
      assert.ok(!html.includes('Book now'), buttonUrl);
    }
  });

  test('attribute breakout through the image or logo URL is impossible', () => {
    const { html } = renderCampaign(
      { ...content, imageUrl: 'https://x.example/a.png" onload="alert(1)' },
      { ...brand, logoUrl: 'https://x.example/l.png"><script>' },
      labels,
      { unsubscribeUrl: URL_ }
    );
    assert.ok(!html.includes('onload="alert'));
    assert.ok(!html.includes('"><script>'));
  });

  test('bold and paragraphs, nothing else', () => {
    const { html } = renderCampaign(content, brand, labels, { unsubscribeUrl: URL_ });
    assert.ok(html.includes('<strong>Bold</strong>'));
    assert.ok(html.includes('First line<br>second line'));
    assert.equal(
      bodyText(content.body),
      'First line\nsecond line\n\nBold and our site (https://finalstop.org/book).'
    );
  });
});

describe('footer and compliance', () => {
  test('every template has the address, the reason and the unsubscribe link', () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      const { html, text } = renderCampaign({ ...content, template }, brand, labels, {
        unsubscribeUrl: URL_
      });
      assert.ok(html.includes('1234 Market Street<br>San Diego, CA 92101'), template);
      assert.ok(html.includes('subscribed on Final Stop'), template);
      assert.ok(html.includes(`href="${URL_.replace('&', '&amp;')}"`), template);
      assert.ok(text.includes(`Unsubscribe: ${URL_}`), template);
      assert.ok(text.includes('San Diego, CA 92101'), template);
    }
  });

  test('a real send without a postal address throws', () => {
    assert.throws(
      () =>
        renderCampaign(content, { ...brand, postalAddress: '  ' }, labels, {
          unsubscribeUrl: URL_
        }),
      (e) => e instanceof CampaignRenderError && e.code === 'postal_address_required'
    );
  });

  test('a real send without an https unsubscribe link throws', () => {
    for (const unsubscribeUrl of [
      null,
      'http://dashboard.levelup-ecosystem.com/u',
      'javascript:x'
    ]) {
      assert.throws(
        () => renderCampaign(content, brand, labels, { unsubscribeUrl }),
        (e) => e instanceof CampaignRenderError && e.code === 'unsubscribe_required'
      );
    }
  });

  test('the preview shows a placeholder instead of throwing', () => {
    const { html } = renderCampaign(content, { ...brand, postalAddress: null }, labels, {
      unsubscribeUrl: null,
      preview: true
    });
    assert.ok(html.includes('Add your postal address'));
    assert.ok(html.includes('Unsubscribe'));
  });
});

describe('unsubscribe headers', () => {
  test('List-Unsubscribe and List-Unsubscribe-Post (RFC 8058)', () => {
    const urls = unsubscribeUrls('https://dashboard.levelup-ecosystem.com/', 'abc_DEF-123', 'c1');
    assert.equal(urls.page, 'https://dashboard.levelup-ecosystem.com/unsubscribe/abc_DEF-123?c=c1');
    assert.equal(
      urls.oneClick,
      'https://dashboard.levelup-ecosystem.com/api/email/unsubscribe/abc_DEF-123?c=c1'
    );
    assert.deepEqual(unsubscribeHeaders(urls.oneClick), {
      'List-Unsubscribe': `<${urls.oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    });
  });

  test('refuses anything but https', () => {
    assert.throws(() => unsubscribeHeaders('http://example.com/u'));
    assert.throws(() => unsubscribeHeaders('mailto:x@example.com'));
  });
});

describe('branding helpers', () => {
  test('colour falls back and the text colour stays readable', () => {
    assert.equal(brandColor('#ABCDEF'), '#abcdef');
    assert.equal(brandColor('red; background:url(x)'), '#111827');
    assert.equal(textOn('#ffffff'), '#111827');
    assert.equal(textOn('#111827'), '#ffffff');
  });

  test('logo: relative path on the domain, https only, never SVG', () => {
    assert.equal(resolveLogoUrl('/logo.png', 'example.com'), 'https://example.com/logo.png');
    assert.equal(resolveLogoUrl('/logo.svg', 'example.com'), null);
    assert.equal(resolveLogoUrl('http://example.com/logo.png', null), null);
    assert.equal(resolveLogoUrl('javascript:alert(1)', null), null);
  });

  test('From header keeps the name on one line without quotes', () => {
    assert.equal(
      fromHeader('Bob "The" Barber\r\nBcc: x@y.z', 'campaigns@levelup-ecosystem.com'),
      '"Bob The Barber Bcc x" <campaigns@levelup-ecosystem.com>'.replace('Bcc x', 'Bcc xy.z')
    );
  });

  test('media URL only for library paths', () => {
    assert.equal(
      mediaPublicUrl('https://p.supabase.co/', 'org/a/site/b/2026/10/x.webp'),
      'https://p.supabase.co/storage/v1/object/public/media/org/a/site/b/2026/10/x.webp'
    );
    assert.equal(mediaPublicUrl('https://p.supabase.co', '../secret'), null);
  });
});

describe('contacts CSV', () => {
  test('header, quoted names, semicolons, duplicates and invalid rows', () => {
    const parsed = parseContactsCsv(
      '﻿Name;Email\n"Doe, Jane";Jane@Example.com\nBob;bob@example.com\nX;not-an-email\nAgain;jane@example.com\n<b>Hi</b>;hi@example.com\n'
    );
    assert.deepEqual(parsed.rows, [
      { email: 'jane@example.com', name: 'Doe, Jane' },
      { email: 'bob@example.com', name: 'Bob' },
      { email: 'hi@example.com', name: null }
    ]);
    assert.equal(parsed.invalid, 1);
    assert.equal(parsed.duplicates, 1);
  });

  test('no header: the column holding addresses', () => {
    const parsed = parseContactsCsv('Ann,ann@example.com\nBen,ben@example.com');
    assert.deepEqual(
      parsed.rows.map((r) => r.email),
      ['ann@example.com', 'ben@example.com']
    );
  });
});
