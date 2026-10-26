/* oxlint-disable no-control-regex -- matching control characters is the point here */

/**
 * Input hygiene shared by every form, service and route handler (see
 * docs/security.md). Pure functions with no imports, so the browser, the server
 * and the tests all run exactly the same rules.
 *
 * - `cleanLine` / `cleanMultiline`: what the user typed, minus the characters
 *   that are never legitimate in our data (control characters, zero-width and
 *   direction-override characters, the invisible Unicode "tag" block used to
 *   smuggle hidden text), Unicode-normalised, whitespace tidied.
 * - `containsMarkup`: HTML tags in a plain-text field.
 * - `safeHttpUrl` / `safeLinkHref` / `isSafeRelativePath`: links we store or render.
 * - `cleanJson` / `findUnsafeJson`: free-form JSON (site settings, page content).
 */

// C0 controls except \t and \n (\r is normalised first), DEL and C1 controls.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// Invisible or text-reordering characters: soft hyphen, Mongolian vowel
// separator, zero-width space, LRM/RLM, bidi embeddings/overrides/isolates,
// word joiner and invisible operators, BOM, and the Unicode tag block
// (U+E0000–U+E007F). ZWNJ/ZWJ (U+200C/U+200D) stay: emoji and some scripts need them.
const INVISIBLE = /[­᠎​‎‏‪-‮⁠-⁤⁦-⁩﻿]|\uDB40[\uDC00-\uDC7F]/g;
// Unpaired UTF-16 surrogates (invalid text, rejected by some databases).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// Horizontal whitespace runs, keeping no-break spaces (French typography).
const SPACES = /[^\S\n  ]+/g;

function baseClean(value: string): string {
  return value
    .replace(LONE_SURROGATE, '�')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '');
}

/** Only removes hidden characters (control, zero-width, bidi overrides, tags); layout untouched. */
export function stripHidden(value: string): string {
  return baseClean(value);
}

/** One line of text: invisible/control characters removed, whitespace collapsed, trimmed. */
export function cleanLine(value: string): string {
  return baseClean(value)
    .replace(/[\n\t]/g, ' ')
    .replace(SPACES, ' ')
    .trim();
}

/**
 * Multi-line text: invisible/control characters removed (tabs and newlines
 * kept), trailing spaces removed, at most one blank line in a row, trimmed.
 */
export function cleanMultiline(value: string): string {
  return baseClean(value)
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when `value` still holds characters `cleanLine`/`cleanMultiline` would remove. */
export function hasHiddenCharacters(value: string): boolean {
  return new RegExp(INVISIBLE.source).test(value) || new RegExp(CONTROL.source).test(value);
}

// An HTML tag or comment: `<b>`, `</div>`, `<img src=x onerror=…>`, `<!--`.
// "a < b", "<3" or "x<5" are not tags.
const MARKUP = /<\/?[a-z][a-z0-9-]*(?:[\s/][^>]*)?>|<!--|<!\[CDATA\[|<\?[a-z]/i;

/** True when a plain-text value contains HTML markup. */
export function containsMarkup(value: string): boolean {
  return MARKUP.test(value);
}

// Script-capable content wherever it appears (JSON content, rich text).
const DANGEROUS = [
  /<\s*\/?\s*(?:script|iframe|frame|object|embed|applet|style|link|meta|base|form|svg|math|template)\b/i,
  /<[^>]*\son[a-z]+\s*=/i,
  // A script URL where a link would start (value start, quote, `=`, `(`, `](`).
  /(?:^|[("'=`])\s*(?:java|vb|live)script\s*:/i,
  /(?:^|[("'=`])\s*data\s*:\s*(?:text\/html|image\/svg\+xml|application\/(?:x-)?javascript)/i,
  /\bsrcdoc\s*=/i
];

/** True when a value carries script-capable HTML or a script URL. */
export function containsDangerousContent(value: string): boolean {
  // Entities and escapes are decoded first so `&#106;avascript:` is caught too.
  const decoded = decodeEntities(value);
  return DANGEROUS.some((re) => re.test(value) || re.test(decoded));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});?/g, (_, dec: string) => codePoint(Number(dec)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;|&newline;/gi, '')
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/[\s\u0000-\u001F]+/g, (m) => (m.includes(' ') ? ' ' : ''));
}

function codePoint(n: number): string {
  return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

// ---------------------------------------------------------------- formats

export const PATTERNS = {
  /** Practical address: no quotes or comments, a dotted domain, a letter TLD. */
  email:
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?=.{4,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/,
  /** Digits, spaces, + ( ) . - only (the digit count is checked separately). */
  phone: /^\+?[0-9 ().-]{6,40}$/,
  /** lowercase-words-with-dashes */
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  /** #rgb, #rrggbb or #rrggbbaa */
  hexColor: /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  /** YYYY-MM-DD (the calendar date is checked separately) */
  isoDate: /^\d{4}-\d{2}-\d{2}$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /** example.com, www.example.co.uk (no scheme, no path) */
  domain: /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,
  /** LevelUp website id (public: it appears in every client site's code). */
  websiteId: /^ws_[a-z0-9]{8,32}$/,
  /** Single-use link token: 32 random bytes, base64url (43 characters). */
  urlToken: /^[A-Za-z0-9_-]{43}$/
} as const;

export function isEmail(value: string): boolean {
  return value.length <= 254 && PATTERNS.email.test(value) && !value.includes('..');
}

export function isPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '').length;
  return PATTERNS.phone.test(value) && digits >= 6 && digits <= 20;
}

/** A real calendar date in YYYY-MM-DD form (2026-02-30 is not). */
export function isIsoDate(value: string): boolean {
  if (!PATTERNS.isoDate.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    y >= 1900 &&
    y <= 2200 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

// ---------------------------------------------------------------- links

export interface HttpUrlOptions {
  /** Refuse http:// (default false: http and https are both accepted). */
  httpsOnly?: boolean;
  /** Accept "example.com/page" and read it as https://example.com/page. */
  allowBareDomain?: boolean;
}

/**
 * The normalised http(s) URL, or null. Refuses every other scheme
 * (javascript:, data:, file:, …), credentials in the URL, whitespace and
 * control characters, protocol-relative `//host` and single-label hosts.
 */
export function safeHttpUrl(raw: string, options: HttpUrlOptions = {}): string | null {
  const value = raw.trim();
  if (!value || value.length > 2048 || /[\s\u0000-\u001F\u007F\\]/.test(value)) return null;
  if (hasHiddenCharacters(value)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (!hasScheme && (!options.allowBareDomain || value.startsWith('/'))) return null;
  let url: URL;
  try {
    url = new URL(hasScheme ? value : `https://${value}`);
  } catch {
    return null;
  }
  const allowed = options.httpsOnly ? ['https:'] : ['https:', 'http:'];
  if (!allowed.includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  const host = url.hostname;
  if (!host.includes('.') || host.endsWith('.') || !/^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$/i.test(host)) {
    return null;
  }
  return url.toString();
}

/** An exact web origin (`https://host[:port]`, no path); http only for localhost. */
export function isWebOrigin(value: string): boolean {
  if (/^http:\/\/localhost(?::\d{2,5})?$/.test(value)) return true;
  const url = safeHttpUrl(value, { httpsOnly: true });
  return !!url && new URL(url).origin === value;
}

const PROBE_ORIGIN = 'https://probe.invalid';

/**
 * A same-site path such as `/projects/x?tab=1`: starts with one `/`, never
 * `//host` or `/\host` (browsers read both as another host), no control
 * characters, and still on this origin once parsed the way browsers do.
 */
export function isSafeRelativePath(value: string): boolean {
  if (!value.startsWith('/') || value.length > 2048) return false;
  if (/^\/[/\\]/.test(value) || /[\s\u0000-\u001F\u007F\\]/.test(value)) return false;
  if (hasHiddenCharacters(value)) return false;
  try {
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

/** `mailto:` link for a valid address, else null (no header injection via `?cc=`). */
export function mailtoHref(email: string | null | undefined): string | null {
  const value = email?.trim() ?? '';
  return isEmail(value) ? `mailto:${value}` : null;
}

/** `tel:` link with digits and a leading + only, else null. */
export function telHref(phone: string | null | undefined): string | null {
  const value = phone?.trim() ?? '';
  if (!isPhone(value)) return null;
  return `tel:${value.replace(/(?!^\+)[^\d]/g, '')}`;
}

/**
 * Href for a link built from stored or user content: http(s) URL, same-site
 * path, mailto: or tel:. Anything else (javascript:, data:, vbscript:, …) is
 * null, so the caller renders plain text instead of a link.
 */
export function safeLinkHref(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (!value) return null;
  if (value.startsWith('/')) return isSafeRelativePath(value) ? value : null;
  if (/^mailto:/i.test(value)) return mailtoHref(value.slice(7));
  if (/^tel:/i.test(value)) return telHref(value.slice(4));
  return safeHttpUrl(value, { allowBareDomain: true });
}

/** Rel attribute for links that open user-provided URLs. */
export const EXTERNAL_LINK_REL = 'noopener noreferrer nofollow';

// ---------------------------------------------------------------- files

/**
 * A storage-safe file name: no directory part, letters/digits/`._-` and
 * spaces only, no leading dot, at most `max` characters, extension kept.
 */
export function safeFileName(name: string, fallback = 'file', max = 120): string {
  const base = baseClean(name).split(/[/\\]/).pop() ?? '';
  const ascii = base
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s.-]+|[\s.-]+$/g, '');
  if (!ascii) return fallback;
  if (ascii.length <= max) return ascii;
  const dot = ascii.lastIndexOf('.');
  const ext = dot > 0 && ascii.length - dot <= 10 ? ascii.slice(dot) : '';
  return ascii.slice(0, max - ext.length).replace(/[\s.-]+$/, '') + ext;
}

// ---------------------------------------------------------------- HTML

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/** Escapes text for an HTML element or a quoted attribute (e-mails). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/** A mail header value (subject, name): one line, no CR/LF, bounded. */
export function cleanHeader(value: string, max = 200): string {
  return cleanLine(value).slice(0, max);
}

// ---------------------------------------------------------------- JSON content

export interface JsonLimits {
  maxDepth?: number;
  maxKeys?: number;
  maxItems?: number;
  maxString?: number;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * A cleaned copy of free-form JSON (strings through `cleanMultiline`, keys
 * through `cleanLine`), or null when it is not plain JSON data or exceeds the
 * limits: too deep, too many keys/items, a too-long string, a non-finite
 * number, or a prototype-polluting key.
 */
export function cleanJson(value: unknown, limits: JsonLimits = {}): unknown | null {
  const { maxDepth = 8, maxKeys = 200, maxItems = 500, maxString = 20000 } = limits;
  const INVALID = Symbol('invalid');
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : INVALID;
    if (typeof v === 'string') {
      const s = cleanMultiline(v);
      return s.length > maxString ? INVALID : s;
    }
    if (depth >= maxDepth) return INVALID;
    if (Array.isArray(v)) {
      if (v.length > maxItems) return INVALID;
      const out: unknown[] = [];
      for (const item of v) {
        const c = walk(item, depth + 1);
        if (c === INVALID) return INVALID;
        out.push(c);
      }
      return out;
    }
    if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length > maxKeys) return INVALID;
      const out: Record<string, unknown> = {};
      for (const [k, item] of entries) {
        const key = cleanLine(k);
        if (!key || key.length > 100 || FORBIDDEN_KEYS.has(key)) return INVALID;
        const c = walk(item, depth + 1);
        if (c === INVALID) return INVALID;
        out[key] = c;
      }
      return out;
    }
    return INVALID;
  };
  const result = walk(value, 0);
  return result === INVALID ? null : result;
}

// Keys whose string values are links (`url`, `href`, `image`, `logo_url`, `ctaLink`…).
const LINK_KEY =
  /(?:^|[_-])(?:url|href|link|src|image|logo|avatar|video|website)s?$|(?:Url|Href|Link|Src|Image|Logo)s?$/;

/**
 * A stored link is unsafe when it would leave http(s)/mailto/tel or point to
 * another host by a protocol-relative path. Plain words (an anchor, a label)
 * are not links and pass.
 */
function isSafeStoredLink(value: string): boolean {
  if (!value || value.startsWith('#')) return true;
  if (value.startsWith('/')) return isSafeRelativePath(value);
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return safeLinkHref(value) !== null;
  return true;
}

/**
 * Path (`branding.logo_url`, `items[2].text`) of the first value that could run
 * script once rendered by a website: script-capable HTML anywhere, or a link
 * field that is not an http(s) URL / same-site path / mailto: / tel:. Null when
 * everything is safe.
 */
export function findUnsafeJson(value: unknown, path = ''): string | null {
  if (typeof value === 'string') {
    if (containsDangerousContent(value)) return path || '(value)';
    const key =
      path
        .split('.')
        .pop()
        ?.replace(/\[\d+\]$/, '') ?? '';
    if (LINK_KEY.test(key) && !isSafeStoredLink(value.trim())) return path;
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findUnsafeJson(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const found = findUnsafeJson(v, path ? `${path}.${k}` : k);
      if (found) return found;
    }
  }
  return null;
}
