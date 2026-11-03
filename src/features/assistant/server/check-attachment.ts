import * as z from 'zod';
import { sniffMimeType } from '@/lib/file-signature';

// Validation of files attached to an assistant message (pure: no network).

export const ATTACHMENT_MAX = 3;
/** Decoded bytes per file (images are resized in the browser before sending). */
export const ATTACHMENT_MAX_BYTES = 1_200_000;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'text/markdown', 'application/json']);

export const AttachmentInput = z.strictObject({
  name: z
    .string()
    .max(120)
    .transform((v) => v.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 80) || 'file'),
  mime: z.string().max(60),
  // Base64 of at most ATTACHMENT_MAX_BYTES bytes.
  data: z
    .string()
    .max(Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4 + 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
});
export type AttachmentInput = z.infer<typeof AttachmentInput>;

type Kind = 'image' | 'pdf' | 'text';
export interface CheckedFile {
  name: string;
  mime: string;
  kind: Kind;
  data: string;
}

/** Real type from the first bytes (never trust the declared one); null when refused. */
export function checkAttachment(file: AttachmentInput): CheckedFile | null {
  const bytes = Buffer.from(file.data, 'base64');
  if (!bytes.length || bytes.length > ATTACHMENT_MAX_BYTES) return null;
  const sniffed = sniffMimeType(bytes);
  if (sniffed && IMAGE_TYPES.has(sniffed) && sniffed === file.mime) {
    return { name: file.name, mime: sniffed, kind: 'image', data: file.data };
  }
  if (sniffed === 'application/pdf' && file.mime === 'application/pdf') {
    return { name: file.name, mime: sniffed, kind: 'pdf', data: file.data };
  }
  if (!sniffed && TEXT_TYPES.has(file.mime)) {
    const text = bytes.toString('utf8');
    // Real text only: no NUL bytes, no invalid UTF-8.
    if (text.includes('\u0000') || text.includes('�')) return null;
    return { name: file.name, mime: file.mime, kind: 'text', data: text };
  }
  return null;
}
