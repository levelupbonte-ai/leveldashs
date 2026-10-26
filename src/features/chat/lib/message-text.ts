import * as z from 'zod';
import { createFields, type FieldMessages } from '@/lib/validation/fields';
import { cleanHeader, cleanMultiline, mailtoHref, safeHttpUrl } from '@/lib/validation/sanitize';

/** Same limit as the database (`chat_send_message`, `chat_edit_message`). */
export const MESSAGE_MAX = 4000;

/**
 * Message body: control, zero-width and bidi characters removed, line breaks
 * kept, 1 to 4000 characters, no HTML tags. The database applies the same rules.
 */
export function messageSchema(messages: FieldMessages = {}) {
  return z.object({
    body: createFields(messages).text(MESSAGE_MAX, { min: 1, multiline: true })
  });
}

/** The cleaned body, or null when it would be refused. */
export function cleanMessageBody(value: string): string | null {
  const parsed = messageSchema().shape.body.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type TextPart =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string };

// http(s) links only; trailing punctuation is not part of the link.
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[).,;:!?\]}’'"»]+$/;

/**
 * Splits plain text into text and link parts. Only http(s) URLs become links,
 * and only when `safeHttpUrl` accepts them; everything else stays text (no
 * HTML is ever produced).
 */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let raw = match[0];
    const trail = raw.match(TRAILING)?.[0] ?? '';
    if (trail) raw = raw.slice(0, -trail.length);
    const href = safeHttpUrl(raw);
    if (!href) continue;
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) });
    parts.push({ type: 'link', value: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

/**
 * `mailto:` link to reply to a visitor: the address is validated, subject and
 * body are cleaned (one header-safe line, plain text) and percent-encoded, so
 * nothing can add recipients or headers. Null when the address is not valid.
 */
export function replyMailto(
  email: string | null | undefined,
  subject: string,
  body = ''
): string | null {
  const base = mailtoHref(email);
  if (!base) return null;
  const params = [`subject=${encodeURIComponent(cleanHeader(subject, 150))}`];
  const text = cleanMultiline(body).slice(0, 1500);
  if (text) params.push(`body=${encodeURIComponent(text)}`);
  return `${base}?${params.join('&')}`;
}

/** Up to two initials for an avatar fallback. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = [...words[0]][0] ?? '';
  const second = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
  return (first + second).toUpperCase();
}
