import * as z from 'zod';
import type { CollectionDef, FieldDef } from '../config/collections';
import type { ContentRow } from '../api/types';

export type FormValues = Record<string, unknown>;

/** Translated validation messages (`site.validation`). */
export interface SchemaMessages {
  https: string;
  number: string;
  amount: string;
  required: string;
  date: string;
  tooLong: string;
}

function fieldSchema(field: FieldDef, m: SchemaMessages) {
  const httpsUrl = z
    .string()
    .trim()
    .max(2048)
    .refine((v) => v === '' || /^https:\/\/[^\s]+$/.test(v), { message: m.https });
  switch (field.kind) {
    case 'number':
      return z.number({ error: m.number }).int().min(0).max(100000).optional();
    case 'money':
      return z.number({ error: m.amount }).min(0).max(1000000).optional();
    case 'switch':
      return z.boolean();
    case 'tags':
      return z.array(z.string().trim().min(1).max(80)).max(30);
    case 'image':
    case 'url':
      return field.required ? httpsUrl.refine((v) => v !== '', { message: m.required }) : httpsUrl;
    case 'date':
      return z.string().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), {
        message: m.date
      });
    default: {
      const base = z
        .string()
        .trim()
        .max(field.max ?? 20000, { message: m.tooLong });
      return field.required ? base.min(1, { message: m.required }) : base;
    }
  }
}

export function buildSchema(def: CollectionDef, messages: SchemaMessages) {
  return z.object(Object.fromEntries(def.fields.map((f) => [f.name, fieldSchema(f, messages)])));
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
        out[f.name] = v === true;
        break;
      case 'tags':
        out[f.name] = Array.isArray(v) ? v : [];
        break;
      case 'date':
        out[f.name] = typeof v === 'string' ? v.slice(0, 10) : '';
        break;
      case 'select':
        out[f.name] =
          v === null || v === undefined
            ? f.name === 'status'
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
