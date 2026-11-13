import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeText, parseFeed } from './parse-feed';

const RSS = `<?xml version="1.0"?><rss><channel><title>T</title>
<item><title><![CDATA[New rules for <b>student</b> visas]]></title><link>https://www.example.gov/news/1</link>
<pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate><description>Fees &amp; deadlines change.</description></item>
<item><title>Insecure link</title><link>http://www.example.gov/news/2</link></item>
<item><title>x</title><link>https://www.example.gov/news/3</link></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Mise à jour : frais d&#233;tude</title>
<link rel="alternate" href="https://www.example.gouv.fr/actu/9"/><updated>2026-11-12T08:00:00Z</updated>
<summary>Les frais changent le 1er janvier.</summary></entry></feed>`;

describe('news feeds', () => {
  it('reads RSS items: https links only, real titles, dates and plain text', () => {
    const items = parseFeed(RSS);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'New rules for student visas');
    assert.equal(items[0].url, 'https://www.example.gov/news/1');
    assert.equal(items[0].publishedAt, '2026-11-10T10:00:00.000Z');
    assert.equal(items[0].description, 'Fees & deadlines change.');
  });

  it('reads Atom entries with their alternate link', () => {
    const [item] = parseFeed(ATOM);
    assert.equal(item.url, 'https://www.example.gouv.fr/actu/9');
    assert.equal(item.title, 'Mise à jour : frais détude');
    assert.equal(item.publishedAt, '2026-11-12T08:00:00.000Z');
  });

  it('decodes entities and strips tags', () => {
    assert.equal(decodeText('<p>A &amp; B&#160;&lt;C&gt;</p>'), 'A & B <C>');
  });
});
