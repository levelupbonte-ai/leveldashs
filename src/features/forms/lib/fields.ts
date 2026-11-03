import type { FormField, FormValues } from '../api/types';

/** "Preferred date" -> "preferred_date" (field ids stay stable once saved). */
export function fieldIdFrom(label: string, taken: string[]): string {
  const base =
    label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 32) || 'field';
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}_${i}`;
  return id;
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
const PHONE = /^\+?[0-9 ().-]{6,20}$/;
const URL_RE = /^https?:\/\/[^\s<>"'`]+\.[^\s<>"'`]+$/i;

export type FieldError =
  | 'required'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'url'
  | 'time'
  | 'rating';

/** Same rules as public_form_submit, checked before sending (the server checks again). */
export function validateValues(
  fields: FormField[],
  values: FormValues
): Record<string, FieldError> {
  const errors: Record<string, FieldError> = {};
  for (const f of fields) {
    if (f.type === 'section') continue;
    const v = values[f.id];
    const empty =
      v === undefined ||
      v === '' ||
      v === false ||
      (typeof v === 'string' && !v.trim()) ||
      (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (f.required) errors[f.id] = 'required';
      continue;
    }
    if (f.type === 'email' && !EMAIL.test(String(v).trim())) errors[f.id] = 'email';
    if (f.type === 'phone' && !PHONE.test(String(v).trim())) errors[f.id] = 'phone';
    if (f.type === 'number' && !Number.isFinite(Number(v))) errors[f.id] = 'number';
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors[f.id] = 'date';
    if (f.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) errors[f.id] = 'time';
    if (f.type === 'url' && !URL_RE.test(String(v).trim())) errors[f.id] = 'url';
    if (f.type === 'rating' && !(Number(v) >= 1 && Number(v) <= (f.max ?? 5)))
      errors[f.id] = 'rating';
  }
  return errors;
}

/** Values as the database expects them (numbers as numbers, empty values left out). */
export function toPayload(fields: FormField[], values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === 'section') continue;
    const v = values[f.id];
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (f.type === 'file') out[f.id] = (v as { path: string }[]).map((x) => x.path);
    else if (f.type === 'number' || f.type === 'rating') out[f.id] = Number(v);
    else if (f.type === 'checkbox') out[f.id] = v === true;
    else if (typeof v === 'string') out[f.id] = v.trim();
    else out[f.id] = v;
  }
  return out;
}
