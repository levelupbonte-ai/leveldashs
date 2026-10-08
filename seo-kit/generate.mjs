#!/usr/bin/env node
// LevelUp SEO kit: generates the SEO files of a client website from the
// LevelUp database (public site bundle), so every site gets the same
// Google / AI-search friendly setup.
//
//   node seo-kit/generate.mjs --website ws_xxxxxxxxxxxxxxxx --out ./public
//   node seo-kit/generate.mjs --website ws_xxx --out ./public --base https://example.com --pages /,/services,/contact
//
// Output (in --out):
//   seo-head.html   meta tags, Open Graph, Twitter, canonical, schema.org JSON-LD (paste in <head>)
//   robots.txt      allows search engines and AI crawlers, points to the sitemap
//   sitemap.xml     the pages passed with --pages (default: /)
//   llms.txt        plain-text summary for AI assistants (Google AI Overviews, ChatGPT, Perplexity…)
//
// Only public data is read (publishable key, same as the website itself). No secret is needed.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rncuhmvykrmtxfzqpitc.supabase.co';
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_C6yyhI8mh1Dcgfw94mxVYg_VIIMqvBE';

const SCHEMA_TYPES = {
  barbershop: 'BarberShop',
  salon: 'HairSalon',
  beauty: 'BeautySalon',
  restaurant: 'Restaurant',
  cafe: 'CafeOrCoffeeShop',
  bakery: 'Bakery',
  store: 'Store',
  clinic: 'MedicalClinic',
  fitness: 'HealthClub',
  legal: 'LegalService',
  agency: 'ProfessionalService',
  events: 'EventVenue'
};
const DAYS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) out[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true';
  }
  return out;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clean = (o) => JSON.parse(JSON.stringify(o, (_k, v) => (v === '' || v == null || (Array.isArray(v) && !v.length) ? undefined : v)));
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : undefined);
const trim = (s, n) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

async function fetchBundle(websiteId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_site_bundle`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_website_id: websiteId })
  });
  if (!res.ok) throw new Error(`get_site_bundle failed (${res.status}): ${await res.text()}`);
  return res.json();
}

function describe(site, seo) {
  // A written description (dashboard → SEO) always wins; otherwise build one
  // Google can use as the snippet: who, where, what (about 150 characters).
  if (seo.description) return seo.description;
  const tagline = site.settings?.branding?.tagline;
  const city = site.settings?.contact?.address?.split(',').slice(-2, -1)[0]?.trim();
  const services = (site.services || []).filter((s) => s.featured).concat(site.services || []);
  const top = [...new Set(services.map((s) => s.name))].slice(0, 3).join(', ');
  const parts = [`${site.name}${city ? ` in ${city}` : ''}${tagline ? ` — ${tagline}` : ''}.`];
  if (top) parts.push(`${top} and more.`);
  if (site.features?.includes?.('appointments')) parts.push('Book online.');
  return trim(parts.join(' '), 160);
}

function buildGraph(site, base, description) {
  const s = site.settings || {};
  const contact = s.contact || {};
  const social = s.social || {};
  const seo = s.seo || {};
  const image = httpUrl(seo.image) || httpUrl(s.branding?.logo_url) || httpUrl(site.gallery?.[0]?.image_url);
  const business = {
    '@type': seo.schema_type || SCHEMA_TYPES[site.site_type] || 'LocalBusiness',
    '@id': `${base}/#business`,
    name: site.name,
    url: base,
    description,
    image,
    logo: httpUrl(s.branding?.logo_url),
    telephone: contact.phones?.[0]?.tel || contact.phone,
    email: contact.emails?.[0] || contact.email,
    priceRange: seo.price_range,
    address: contact.address && { '@type': 'PostalAddress', streetAddress: contact.address },
    hasMap: httpUrl(contact.maps_url),
    sameAs: Object.values(social).filter(httpUrl),
    openingHoursSpecification: Object.entries(s.hours?.weekly || {})
      .filter(([, v]) => Array.isArray(v))
      .map(([d, [opens, closes]]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAYS[d], opens, closes })),
    hasOfferCatalog: (site.services || []).length
      ? {
          '@type': 'OfferCatalog',
          name: `${site.name} services`,
          itemListElement: site.services.slice(0, 30).map((sv) => ({
            '@type': 'Offer',
            itemOffered: { '@type': 'Service', name: sv.name, description: sv.description },
            price: sv.price_cents != null ? (sv.price_cents / 100).toFixed(2) : undefined,
            priceCurrency: sv.price_cents != null ? (sv.currency || 'USD').toUpperCase() : undefined
          }))
        }
      : undefined
  };
  // Only real, published reviews from the database: never invent ratings (Google penalises it).
  const reviews = (site.reviews || []).filter((r) => r.rating >= 1 && r.rating <= 5);
  if (reviews.length) {
    business.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1),
      reviewCount: reviews.length
    };
    business.review = reviews.slice(0, 5).map((r) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: r.author },
      reviewRating: { '@type': 'Rating', ratingValue: r.rating },
      reviewBody: r.comment,
      datePublished: r.review_date
    }));
  }
  const graph = [
    { '@type': 'WebSite', '@id': `${base}/#website`, url: base, name: site.name, publisher: { '@id': `${base}/#business` } },
    business
  ];
  if ((site.faq || []).length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${base}/#faq`,
      mainEntity: site.faq.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } }))
    });
  }
  return clean({ '@context': 'https://schema.org', '@graph': graph });
}

function headHtml(site, base, description, graph) {
  const seo = site.settings?.seo || {};
  const title = seo.title || site.name;
  const image = httpUrl(seo.image) || httpUrl(site.gallery?.[0]?.image_url);
  const lines = [
    `<!-- LevelUp SEO kit · ${site.id} · generated ${new Date().toISOString().slice(0, 10)} -->`,
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    seo.keywords && `<meta name="keywords" content="${esc([].concat(seo.keywords).join(', '))}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />`,
    `<link rel="canonical" href="${esc(base)}/" />`,
    seo.google_site_verification && `<meta name="google-site-verification" content="${esc(seo.google_site_verification)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(site.name)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(base)}/" />`,
    image && `<meta property="og:image" content="${esc(image)}" />`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    image && `<meta name="twitter:image" content="${esc(image)}" />`,
    `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>`
  ];
  return lines.filter(Boolean).join('\n') + '\n';
}

function robotsTxt(base) {
  return `User-agent: *\nAllow: /\n\n# AI search engines (Google AI Overviews use Googlebot)\nUser-agent: Google-Extended\nAllow: /\nUser-agent: GPTBot\nAllow: /\nUser-agent: OAI-SearchBot\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`;
}

function sitemapXml(base, pages) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = pages
    .map((p) => `  <url><loc>${esc(base + (p === '/' ? '/' : p))}</loc><lastmod>${today}</lastmod><priority>${p === '/' ? '1.0' : '0.8'}</priority></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function llmsTxt(site, base, description) {
  const s = site.settings || {};
  const out = [`# ${site.name}`, `> ${description}`, '', `Website: ${base}`];
  if (s.contact?.address) out.push(`Address: ${s.contact.address}`);
  for (const p of s.contact?.phones || []) out.push(`Phone: ${p.display || p.tel}${p.label ? ` (${p.label})` : ''}`);
  for (const e of s.contact?.emails || []) out.push(`Email: ${e}`);
  if (s.hours?.summary?.length) out.push('', '## Hours', ...s.hours.summary.map((h) => `- ${h}`));
  if ((site.services || []).length) {
    out.push('', '## Services');
    for (const sv of site.services) out.push(`- ${sv.name}${sv.price_label ? ` — ${sv.price_label}` : ''}${sv.description ? `: ${sv.description}` : ''}`);
  }
  if ((site.team || []).length) out.push('', '## Team', ...site.team.map((t) => `- ${t.name}${t.role ? `, ${t.role}` : ''}`));
  if ((site.faq || []).length) {
    out.push('', '## FAQ');
    for (const f of site.faq) out.push(`### ${f.question}`, f.answer, '');
  }
  out.push('', `Website built and maintained by LevelUp Ecosystem (https://levelup-ecosystem.com).`);
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

async function main() {
  const a = args();
  if (!a.website || !/^ws_[a-f0-9]{16}$/.test(a.website)) {
    console.error('Usage: node seo-kit/generate.mjs --website ws_xxxxxxxxxxxxxxxx [--out ./public] [--base https://domain] [--pages /,/services]');
    process.exit(1);
  }
  const site = await fetchBundle(a.website);
  const base = (a.base || (site.primary_domain ? `https://${site.primary_domain}` : '')).replace(/\/+$/, '');
  if (!base.startsWith('https://')) throw new Error('No https base URL: pass --base https://your-domain.com');
  const pages = (a.pages || '/').split(',').map((p) => p.trim()).filter(Boolean);
  const description = describe(site, site.settings?.seo || {});
  const graph = buildGraph(site, base, description);
  const outDir = path.resolve(a.out || './seo-out');
  await mkdir(outDir, { recursive: true });
  const files = {
    'seo-head.html': headHtml(site, base, description, graph),
    'robots.txt': robotsTxt(base),
    'sitemap.xml': sitemapXml(base, pages),
    'llms.txt': llmsTxt(site, base, description)
  };
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(outDir, name), body);
  console.log(`SEO files for ${site.name} (${base}) written to ${outDir}:\n  ${Object.keys(files).join('\n  ')}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
