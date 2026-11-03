/**
 * Generic form handling: any form a website sends (`submit_form` with its own
 * `p_form_type` and `p_data`) is shown without a per-site configuration. The
 * fields are detected from the data itself.
 */

/** Keys of `data` across rows, most frequent first (at most `max`). */
export function detectDataFields(rows: { data: Record<string, unknown> | null }[], max = 40) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.data || typeof row.data !== 'object') continue;
    for (const key of Object.keys(row.data)) {
      if (key.startsWith('_')) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([key]) => key);
}

/** snake_case / camelCase key -> "Snake case" label. */
export function fieldLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/**
 * A data value as plain text (rendered as text by React, never as HTML).
 * Arrays are joined, objects flattened one level, long text cut.
 */
export function displayValue(value: unknown, max = 2000): string {
  if (value === null || value === undefined) return '';
  const files = uploadedFiles(value);
  if (files.length)
    return files
      .map((f) => f.name)
      .join(', ')
      .slice(0, max);
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (Array.isArray(value))
    return value
      .map((v) => displayValue(v, max))
      .filter(Boolean)
      .join(', ')
      .slice(0, max);
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${fieldLabel(k)}: ${displayValue(v, 200)}`)
      .join(' · ')
      .slice(0, max);
  }
  return String(value).slice(0, max);
}

/** Form type key -> readable name when there is no translation ("vip_signup" -> "Vip signup"). */
export function formTypeLabel(type: string): string {
  return fieldLabel(type);
}

/** A file a visitor sent with a LevelUp form (private bucket form-uploads). */
export interface UploadedFile {
  file: string;
  name: string;
  mime: string;
  size?: number;
}

/** The files of a form answer, or [] when the value is not a list of uploads. */
export function uploadedFiles(value: unknown): UploadedFile[] {
  if (!Array.isArray(value) || !value.length) return [];
  const files = value.filter(
    (v): v is UploadedFile =>
      !!v &&
      typeof v === 'object' &&
      typeof (v as UploadedFile).file === 'string' &&
      /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z]{3,4}$/.test((v as UploadedFile).file) &&
      typeof (v as UploadedFile).name === 'string'
  );
  return files.length === value.length ? files : [];
}
