import { AppError } from '@/lib/errors';
import { assertFileSignature } from '@/lib/file-signature';
import { createClient } from '@/lib/supabase/client';

const MAX_SIDE = 512;
const BRAND_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Picked file: resized below, so it may be larger than what is stored. */
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
/** Stored file: the `brand` bucket's own limit (file_size_limit = 2 MB). */
export const BRAND_MAX_BYTES = 2 * 1024 * 1024;

/** Square-ish brand image (avatar, logo) resized in the browser to WebP, keeping transparency. */
async function toWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9)
  );
  if (!blob) throw new AppError('imageUnreadable');
  return blob;
}

/**
 * Uploads to the public "brand" bucket under `avatars/<user id>` or `orgs/<org id>`
 * (storage policies only allow the user's own folder / organizations they admin)
 * and returns the public URL.
 */
export async function uploadBrandImage(file: File, folder: string): Promise<string> {
  if (file.size > MAX_INPUT_BYTES) throw new AppError('imageTooLarge');
  // PNG, JPEG or WebP by content, not just by name (never SVG).
  await assertFileSignature(file, BRAND_TYPES, 'imageFormat');
  const blob = await toWebp(file);
  if (blob.size > BRAND_MAX_BYTES) throw new AppError('imageTooLarge');
  const db = createClient();
  const path = `${folder}/${Date.now()}.webp`;
  const { error } = await db.storage
    .from('brand')
    .upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  if (error) throw new AppError('uploadFailed', { cause: error });
  return db.storage.from('brand').getPublicUrl(path).data.publicUrl;
}
