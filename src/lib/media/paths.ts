/**
 * Object names in the `media` bucket (enforced by the storage policies and the
 * `media` table, migration media_storage):
 *   org/<organization id>/site/<website id>/<yyyy>/<mm>/<uuid>.<ext>
 *   org/<organization id>/site/<website id>/<yyyy>/<mm>/<uuid>_thumb.webp
 * Every upload gets a new name (files are immutable), so a one-year cache is safe.
 */

/** One year: files never change under the same name. */
export const MEDIA_CACHE_SECONDS = '31536000';

export function mediaObjectPath(
  organizationId: string,
  websiteId: string,
  id: string,
  ext: string,
  date: Date = new Date()
): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `org/${organizationId}/site/${websiteId}/${yyyy}/${mm}/${id}.${ext}`;
}

/** The generated thumbnail next to a file (always WebP). */
export function thumbPathFor(path: string): string {
  return path.replace(/\.[a-z0-9]+$/, '_thumb.webp');
}

/** File name shown in the library: the original name with the stored extension. */
export function storedFileName(original: string, ext: string): string {
  const base = original.replace(/\.[^./\\]*$/, '').trim();
  return `${base || 'upload'}.${ext}`;
}
