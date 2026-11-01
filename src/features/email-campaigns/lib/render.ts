import { cleanHeader, cleanLine, escapeHtml, safeHttpUrl } from '@/lib/validation/sanitize';

/**
 * Campaign e-mails: the HTML and text versions, built from plain text only.
 * Pure functions (no server or browser API), so the editor preview and the
 * sender render exactly the same thing.
 *
 * - Every value the user typed is escaped; the body understands paragraphs,
 *   line breaks, **bold** and [label](https://link) and nothing else.
 * - Links and the button accept http(s) only; the logo https only, never SVG
 *   (most mail clients cannot show it).
 * - The footer cannot be turned off: business name, postal address, why the
 *   person receives the e-mail and a one-click unsubscribe link. A real send
 *   without a postal address or an unsubscribe link throws.
 * - Email-safe markup: tables, inline styles, 600 px column that shrinks on
 *   phones, hidden preview text.
 */

export const CAMPAIGN_TEMPLATES = [
  'newsletter',
  'announcement',
  'promotion',
  'event',
  'letter',
  'thank_you'
] as const;
export type CampaignTemplate = (typeof CAMPAIGN_TEMPLATES)[number];

export const SUBJECT_MAX = 120;
export const PREVIEW_MAX = 150;
export const HEADING_MAX = 150;
export const BODY_MAX = 10000;
export const BUTTON_LABEL_MAX = 40;

export interface CampaignContent {
  template: CampaignTemplate;
  locale: 'en' | 'fr';
  subject: string;
  previewText: string;
  heading: string;
  body: string;
  buttonLabel: string | null;
  buttonUrl: string | null;
  imageUrl: string | null;
}

export interface CampaignBrand {
  businessName: string;
  siteName: string;
  siteDomain: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  postalAddress: string | null;
}

/** Footer wording, already translated in the campaign's language. */
export interface FooterLabels {
  /** "You're receiving this because you subscribed on <site>." */
  reason: string;
  unsubscribe: string;
  /** Shown in the preview only, where the postal address is still missing. */
  addressMissing: string;
}

export interface RenderOptions {
  /** The visible unsubscribe link (page with a confirmation button). Required for a real send. */
  unsubscribeUrl: string | null;
  /** Editor preview: missing pieces are shown as placeholders instead of throwing. */
  preview?: boolean;
}

export class CampaignRenderError extends Error {
  constructor(readonly code: 'postal_address_required' | 'unsubscribe_required') {
    super(code);
    this.name = 'CampaignRenderError';
  }
}

const DEFAULT_COLOR = '#111827';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',Times,serif";

/** #rrggbb from settings, or a neutral dark grey. */
export function brandColor(value: string | null | undefined): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_COLOR;
}

/** Black or white, whichever reads best on `hex`. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#111827' : '#ffffff';
}

/** An https logo e-mail clients can show: relative paths on the site's domain, never SVG. */
export function resolveLogoUrl(
  raw: string | null | undefined,
  domain: string | null
): string | null {
  const value = raw?.trim() ?? '';
  if (!value) return null;
  const absolute =
    value.startsWith('/') && !value.startsWith('//') && domain
      ? `https://${domain}${value}`
      : value;
  const url = safeHttpUrl(absolute, { httpsOnly: true });
  if (!url) return null;
  return /\.svgz?$/i.test(new URL(url).pathname) ? null : url;
}

/** Public URL of a media library file (bucket `media`). */
export function mediaPublicUrl(supabaseUrl: string, path: string | null): string | null {
  if (!path || !/^[A-Za-z0-9/_.-]{1,300}$/.test(path) || path.includes('..')) return null;
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/media/${path}`;
}

/** `"Business name" <address>`: one line, no quotes or angle brackets in the name. */
export function fromHeader(name: string, address: string): string {
  const clean =
    cleanHeader(name, 60)
      .replace(/["\\<>,;:@]/g, '')
      .trim() || 'LevelUp';
  return `"${clean}" <${address}>`;
}

/** The links of one recipient: the page (footer) and the one-click endpoint (headers). */
export function unsubscribeUrls(base: string, token: string, campaignId: string) {
  const root = base.replace(/\/$/, '');
  const query = `?c=${encodeURIComponent(campaignId)}`;
  return {
    page: `${root}/unsubscribe/${encodeURIComponent(token)}${query}`,
    oneClick: `${root}/api/email/unsubscribe/${encodeURIComponent(token)}${query}`
  };
}

/** RFC 2369 + RFC 8058 headers: mail apps show an "Unsubscribe" button that works in one click. */
export function unsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  const url = safeHttpUrl(oneClickUrl, { httpsOnly: true });
  if (!url) throw new CampaignRenderError('unsubscribe_required');
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  };
}

// ---------------------------------------------------------------- body

const INLINE = /(\*\*[^*\n]{1,500}?\*\*|\[[^\]\n]{1,200}\]\([^)\s]{1,2048}\))/;

function inlineHtml(text: string, linkColor: string): string {
  let out = '';
  let rest = text;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out += escapeHtml(rest);
      break;
    }
    out += escapeHtml(rest.slice(0, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      out += `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
    } else {
      const [, label = '', href = ''] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) ?? [];
      const url = safeHttpUrl(href);
      out += url
        ? `<a href="${escapeHtml(url)}" style="color:${linkColor};text-decoration:underline">${escapeHtml(label)}</a>`
        : escapeHtml(label);
    }
    rest = rest.slice(m.index + token.length);
  }
  return out;
}

function inlineText(text: string): string {
  return text
    .replace(/\*\*([^*\n]{1,500}?)\*\*/g, '$1')
    .replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,2048})\)/g, (_, label: string, href: string) => {
      const url = safeHttpUrl(href);
      return url ? `${label} (${url})` : label;
    });
}

function paragraphs(body: string): string[][] {
  return body
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((p) => p.split('\n').map((l) => l.trim()))
    .filter((p) => p.some(Boolean));
}

/** Body as HTML paragraphs (escaped, bold, http(s) links). */
export function bodyHtml(body: string, linkColor: string, style: string): string {
  return paragraphs(body)
    .map(
      (lines) =>
        `<p style="${style}">${lines.map((l) => inlineHtml(l, linkColor)).join('<br>')}</p>`
    )
    .join('');
}

/** Body as plain text (formatting markers removed, links as "label (url)"). */
export function bodyText(body: string): string {
  return paragraphs(body)
    .map((lines) => lines.map(inlineText).join('\n'))
    .join('\n\n');
}

// ---------------------------------------------------------------- templates

interface Layout {
  header: 'logo' | 'banner' | 'name';
  align: 'left' | 'center';
  font: string;
  image: 'top' | 'inline';
  /** How the heading is set off. */
  heading: 'plain' | 'offer' | 'bar' | 'large';
}

const LAYOUTS: Record<CampaignTemplate, Layout> = {
  newsletter: { header: 'logo', align: 'left', font: FONT, image: 'inline', heading: 'plain' },
  announcement: { header: 'banner', align: 'left', font: FONT, image: 'inline', heading: 'plain' },
  promotion: { header: 'logo', align: 'center', font: FONT, image: 'inline', heading: 'offer' },
  event: { header: 'logo', align: 'left', font: FONT, image: 'top', heading: 'bar' },
  letter: { header: 'name', align: 'left', font: SERIF, image: 'inline', heading: 'plain' },
  thank_you: { header: 'logo', align: 'center', font: FONT, image: 'inline', heading: 'large' }
};

function headerHtml(
  layout: Layout,
  brand: CampaignBrand,
  color: string,
  logo: string | null,
  heading: string
) {
  const name = escapeHtml(brand.businessName);
  const logoImg = logo
    ? `<img src="${escapeHtml(logo)}" alt="${name}" height="44" style="display:block;height:44px;width:auto;max-width:220px;border:0;outline:none;text-decoration:none${layout.align === 'center' ? ';margin:0 auto' : ''}">`
    : `<span style="font-size:20px;font-weight:700;color:#111827">${name}</span>`;
  if (layout.header === 'banner') {
    const fg = textOn(color);
    return `<tr><td style="background:${color};padding:28px 32px;border-radius:12px 12px 0 0" class="lu-p">
<p style="margin:0 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:${fg};opacity:.85">${name}</p>
${heading ? `<h1 style="margin:0;font-size:26px;line-height:1.25;color:${fg}">${escapeHtml(heading)}</h1>` : ''}
</td></tr>`;
  }
  if (layout.header === 'name') {
    return `<tr><td style="padding:28px 32px 0" class="lu-p"><p style="margin:0;font-size:15px;font-weight:700;color:#111827">${name}</p></td></tr>`;
  }
  return `<tr><td style="padding:28px 32px 8px;border-top:4px solid ${color};border-radius:12px 12px 0 0;text-align:${layout.align}" class="lu-p">${logoImg}</td></tr>`;
}

function headingHtml(layout: Layout, heading: string, color: string): string {
  if (!heading || layout.header === 'banner') return '';
  const text = escapeHtml(heading);
  switch (layout.heading) {
    case 'offer':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="border:2px dashed ${color};border-radius:12px;padding:20px;text-align:center"><h1 style="margin:0;font-size:28px;line-height:1.2;color:${color}">${text}</h1></td></tr></table>`;
    case 'bar':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr><td style="border-left:4px solid ${color};padding:2px 0 2px 14px"><h1 style="margin:0;font-size:24px;line-height:1.25;color:#111827">${text}</h1></td></tr></table>`;
    case 'large':
      return `<h1 style="margin:8px 0 16px;font-size:32px;line-height:1.2;color:${color}">${text}</h1>`;
    default:
      return `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#111827">${text}</h1>`;
  }
}

function imageHtml(url: string | null, top: boolean): string {
  const safe = url ? safeHttpUrl(url, { httpsOnly: true }) : null;
  if (!safe) return '';
  const img = `<img src="${escapeHtml(safe)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none${top ? '' : ';border-radius:10px'}">`;
  return top
    ? `<tr><td style="padding:0">${img}</td></tr>`
    : `<div style="margin:0 0 20px">${img}</div>`;
}

function buttonHtml(content: CampaignContent, color: string, align: 'left' | 'center'): string {
  const url = content.buttonUrl ? safeHttpUrl(content.buttonUrl) : null;
  const label = content.buttonLabel ? cleanLine(content.buttonLabel) : '';
  if (!url || !label) return '';
  const fg = textOn(color);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px ${align === 'center' ? 'auto' : '0'} 8px"><tr><td style="background:${color};border-radius:10px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:${fg};text-decoration:none;border-radius:10px">${escapeHtml(label)}</a></td></tr></table>`;
}

const PREHEADER_PAD = '&#8199;&#847;'.repeat(40);

/** HTML and text of one e-mail. Throws `CampaignRenderError` when a real send misses its footer pieces. */
export function renderCampaign(
  content: CampaignContent,
  brand: CampaignBrand,
  labels: FooterLabels,
  options: RenderOptions
): { html: string; text: string; subject: string } {
  const address = brand.postalAddress?.trim() ?? '';
  if (!options.preview && !address) throw new CampaignRenderError('postal_address_required');
  const unsubscribe = options.unsubscribeUrl
    ? safeHttpUrl(options.unsubscribeUrl, { httpsOnly: true })
    : null;
  if (!options.preview && !unsubscribe) throw new CampaignRenderError('unsubscribe_required');

  const layout = LAYOUTS[content.template] ?? LAYOUTS.newsletter;
  const color = brandColor(brand.brandColor);
  const logo = resolveLogoUrl(brand.logoUrl, brand.siteDomain);
  const subject = cleanHeader(content.subject, 120);
  const heading = cleanLine(content.heading);
  const textStyle = `margin:0 0 14px;font-size:16px;line-height:1.6;color:#374151;text-align:${layout.align}`;
  const addressHtml = address
    ? escapeHtml(address).replace(/\n/g, '<br>')
    : `<span style="color:#b91c1c">${escapeHtml(labels.addressMissing)}</span>`;
  const unsubscribeLink = `<a href="${escapeHtml(unsubscribe ?? '#')}" style="color:#6b7280;text-decoration:underline">${escapeHtml(labels.unsubscribe)}</a>`;

  const html = `<!doctype html>
<html lang="${content.locale === 'fr' ? 'fr' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(subject)}</title>
<style>@media (max-width:620px){.lu-p{padding-left:20px!important;padding-right:20px!important}.lu-wrap{padding:12px 6px!important}}</style></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:${layout.font};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(cleanLine(content.previewText))}${PREHEADER_PAD}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" class="lu-wrap" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;font-family:${layout.font}">
${layout.image === 'top' ? imageHtml(content.imageUrl, true) : ''}
${headerHtml(layout, brand, color, logo, heading)}
<tr><td class="lu-p" style="padding:20px 32px 32px;text-align:${layout.align}">
${headingHtml(layout, heading, color)}
${layout.image === 'inline' ? imageHtml(content.imageUrl, false) : ''}
${bodyHtml(content.body, color, textStyle)}
${buttonHtml(content, color, layout.align)}
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td class="lu-p" style="padding:20px 32px;font-family:${FONT};font-size:12px;line-height:1.6;color:#6b7280;text-align:center">
<p style="margin:0 0 6px;font-weight:600;color:#374151">${escapeHtml(brand.businessName)}</p>
<p style="margin:0 0 10px">${addressHtml}</p>
<p style="margin:0 0 10px">${escapeHtml(labels.reason)}</p>
<p style="margin:0">${unsubscribeLink}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;

  const button =
    content.buttonUrl && content.buttonLabel && safeHttpUrl(content.buttonUrl)
      ? `${cleanLine(content.buttonLabel)}: ${safeHttpUrl(content.buttonUrl)}`
      : '';
  const text = [
    brand.businessName,
    heading,
    bodyText(content.body),
    button,
    '—',
    brand.businessName,
    address || labels.addressMissing,
    labels.reason,
    `${labels.unsubscribe}: ${unsubscribe ?? ''}`
  ]
    .filter(Boolean)
    .join('\n\n');

  return { html, text, subject };
}
