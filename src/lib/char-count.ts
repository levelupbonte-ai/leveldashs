/**
 * Character counter shown under text fields with a `maxLength` ("42 / 160").
 * Counts like the `maxLength` attribute and Zod's `.max()` (UTF-16 units), so
 * the counter, the browser and the validation always agree.
 */

export type CharCountTone = 'normal' | 'near' | 'over';

/**
 * "near" from 90 % of the limit, or only in the last 10 characters on long
 * fields (4000: from 3990), "over" past it.
 */
export function charCountTone(count: number, max: number): CharCountTone {
  if (max <= 0) return 'normal';
  if (count > max) return 'over';
  if (count >= Math.max(max - 10, Math.ceil(max * 0.9))) return 'near';
  return 'normal';
}

/**
 * Free-text inputs get the counter; formatted ones (email, url, tel, password,
 * number, date…) only get the `maxLength` attribute.
 */
const COUNTED_TYPES = new Set(['text', 'search']);

export function isCountedType(type: string | undefined): boolean {
  return type === undefined || COUNTED_TYPES.has(type);
}
