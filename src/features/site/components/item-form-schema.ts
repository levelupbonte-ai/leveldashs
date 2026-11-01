import * as z from 'zod';
import { createFields, type FieldMessages } from '@/lib/validation/fields';
import {
  cleanLine,
  cleanMultiline,
  containsDangerousContent,
  containsMarkup,
  isEmail,
  isIsoDate,
  isPhone,
  isSafeRelativePath,
  safeHttpUrl
} from '@/lib/validation/sanitize';
import type { CollectionDef, FieldDef } from '../config/collections';
import type { ContentRow } from '../api/types';

export type FormValues = Record<string, unknown>;

/** Translated validation messages (`site.validation`, plus the shared `validation.*`). */
export interface SchemaMessages {
  https: string;
  number: string;
  amount: string;
  required: string;
  date: string;
  tooLong: string;
  noHtml?: string;
  choice?: string;
  email?: string;
  phone?: string;
}

// Text fields whose name says what they hold get that format checked.
const EMAIL_FIELDS = new Set(['email']);
const PHONE_FIELDS = new Set(['phone']);
// Showcase links: an https site or a page of the site (/projects/x).
const LINK_FIELDS = new Set(['url']);

function selectValues(field: FieldDef): [string, ...string[]] | null {
  const values = (field.options ?? []).map((o) => o.value);
  return values.length ? (values as [string, ...string[]]) : null;
}

function fieldSchema(field: FieldDef, m: SchemaMessages) {
  // Shared builders: strings cleaned (hidden characters, whitespace), bounded,
  // HTML refused. Formats keep the collection editor's own messages.
  const shared: FieldMessages = {
    required: m.required,
    date: m.date,
    tooLong: () => m.tooLong,
    tooMany: () => m.tooLong,
    noHtml: m.noHtml,
    choice: m.choice,
    email: m.email,
    phone: m.phone
  };
  const f = createFields(shared);
  const https = createFields({ ...shared, url: m.https });
  switch (field.kind) {
    case 'number':
      return z.number({ error: m.number }).int().min(0).max(100000).optional();
    case 'money':
      return z.number({ error: m.amount }).min(0).max(1000000).optional();
    case 'switch':
      return z.boolean();
    case 'tags':
      return f.tags(field.maxItems ?? 30, field.max ?? 80);
    case 'images':
      return z.array(https.url({ httpsOnly: true, required: true })).max(12);
    case 'image':
    case 'url':
      return https.url({ httpsOnly: true, required: field.required });
    case 'date':
      return f.date({ required: field.required });
    case 'select': {
      const values = selectValues(field);
      if (!values) return f.text(field.max ?? 200);
      const choice = z.enum(values, { message: m.choice });
      return field.required ? choice : z.union([choice, z.literal('')]);
    }
    default: {
      if (EMAIL_FIELDS.has(field.name)) return f.email({ required: field.required });
      if (PHONE_FIELDS.has(field.name)) return f.phone({ required: field.required });
      if (LINK_FIELDS.has(field.name)) {
        return https.url({ httpsOnly: true, allowPath: true, required: field.required });
      }
      return f.text(field.max ?? 20000, {
        min: field.required ? 1 : undefined,
        multiline: field.kind === 'textarea'
      });
    }
  }
}

export function buildSchema(def: CollectionDef, messages: SchemaMessages) {
  return z.object(Object.fromEntries(def.fields.map((f) => [f.name, fieldSchema(f, messages)])));
}

/** A text column as stored: cleaned, bounded, no HTML or script content (null = refused). */
function cleanColumn(v: string, field: FieldDef): string | null {
  const clean = field.kind === 'textarea' ? cleanMultiline(v) : cleanLine(v);
  if (clean.length > (field.max ?? 20000)) return null;
  if (containsMarkup(clean) || containsDangerousContent(clean)) return null;
  return clean;
}

/**
 * Service-side check of the database columns about to be written (form values
 * after `toRow`, or an assistant proposal): only the collection's own fields,
 * strings cleaned, bounded and free of HTML/script, links https (or a site
 * path), selects among their options. Returns the cleaned columns, or null.
 */
export function sanitizeRow(
  def: CollectionDef,
  values: Record<string, unknown>
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const field of def.fields) {
    if (!(field.name in values)) continue;
    const v = values[field.name];
    if (v === null || v === undefined) {
      out[field.name] = null;
      continue;
    }
    switch (field.kind) {
      case 'number':
      case 'money':
        if (typeof v !== 'number' || !Number.isFinite(v)) return null;
        out[field.name] = v;
        break;
      case 'switch':
        if (typeof v !== 'boolean') return null;
        out[field.name] = v;
        break;
      case 'tags':
      case 'images': {
        if (!Array.isArray(v) || v.length > (field.kind === 'tags' ? (field.maxItems ?? 30) : 12)) {
          return null;
        }
        const items: string[] = [];
        for (const item of v) {
          if (typeof item !== 'string') return null;
          const clean =
            field.kind === 'images'
              ? safeHttpUrl(item, { httpsOnly: true })
              : cleanColumn(item, { ...field, max: field.max ?? 80 });
          if (clean === null) return null;
          items.push(clean);
        }
        out[field.name] = items;
        break;
      }
      case 'image':
      case 'url': {
        if (typeof v !== 'string') return null;
        const url = safeHttpUrl(v, { httpsOnly: true });
        if (!url) return null;
        out[field.name] = url;
        break;
      }
      case 'select': {
        const values = selectValues(field);
        const value = field.name === 'rating' ? String(v) : v;
        if (typeof value !== 'string' || (values && !values.includes(value))) return null;
        out[field.name] = v;
        break;
      }
      case 'date':
        if (typeof v !== 'string' || !isIsoDate(v.slice(0, 10))) return null;
        out[field.name] = v;
        break;
      default: {
        if (typeof v !== 'string') return null;
        const clean = cleanColumn(v, field);
        if (clean === null) return null;
        if (EMAIL_FIELDS.has(field.name) && clean && !isEmail(clean)) return null;
        if (PHONE_FIELDS.has(field.name) && clean && !isPhone(clean)) return null;
        if (
          LINK_FIELDS.has(field.name) &&
          clean &&
          !isSafeRelativePath(clean) &&
          !safeHttpUrl(clean, { httpsOnly: true })
        ) {
          return null;
        }
        out[field.name] = clean === '' ? null : clean;
      }
    }
  }
  return out;
}

/** Database row -> form values */
export function toFormValues(def: CollectionDef, row: ContentRow | null): FormValues {
  const out: FormValues = {};
  for (const f of def.fields) {
    const v = row?.[f.name];
    switch (f.kind) {
      case 'number':
        out[f.name] = typeof v === 'number' ? v : f.name === 'sort_order' ? 0 : undefined;
        break;
      case 'money':
        out[f.name] = typeof v === 'number' ? v / 100 : undefined;
        break;
      case 'switch':
        out[f.name] = row ? v === true : f.defaultValue === true;
        break;
      case 'tags':
      case 'images':
        out[f.name] = Array.isArray(v) ? v : [];
        break;
      case 'date':
        out[f.name] = typeof v === 'string' ? v.slice(0, 10) : '';
        break;
      case 'select':
        out[f.name] =
          v === null || v === undefined
            ? typeof f.defaultValue === 'string'
              ? f.defaultValue
              : f.name === 'status'
                ? def.key === 'announcements'
                  ? 'draft'
                  : 'published'
                : ''
            : String(v);
        break;
      default:
        out[f.name] = typeof v === 'string' ? v : '';
    }
  }
  return out;
}

/** Form values -> database columns */
export function toRow(def: CollectionDef, values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    const v = values[f.name];
    switch (f.kind) {
      case 'number':
        out[f.name] = typeof v === 'number' ? Math.round(v) : f.name === 'sort_order' ? 0 : null;
        break;
      case 'money':
        out[f.name] = typeof v === 'number' ? Math.round(v * 100) : null;
        break;
      case 'switch':
        out[f.name] = v === true;
        break;
      case 'tags':
      case 'images':
        out[f.name] = Array.isArray(v) ? v : [];
        break;
      case 'select':
        out[f.name] = v === '' || v === undefined ? null : f.name === 'rating' ? Number(v) : v;
        break;
      default: {
        const s = typeof v === 'string' ? v.trim() : '';
        out[f.name] = s === '' ? null : s;
      }
    }
  }
  return out;
}
