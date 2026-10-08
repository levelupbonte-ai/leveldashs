import { createClient } from '@/lib/supabase/client';

const MAX_SIDE = 512;

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
  if (!blob) throw new Error('Image illisible.');
  return blob;
}

/**
 * Uploads to the public "brand" bucket under `avatars/<user id>` or `orgs/<org id>`
 * (storage policies only allow the user's own folder / organizations they admin)
 * and returns the public URL.
 */
export async function uploadBrandImage(file: File, folder: string): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type))
    throw new Error('Formats acceptés : PNG, JPG ou WebP.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Image trop lourde (8 Mo maximum).');
  const blob = await toWebp(file);
  const db = createClient();
  const path = `${folder}/${Date.now()}.webp`;
  const { error } = await db.storage
    .from('brand')
    .upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  if (error) throw new Error('Envoi de l’image impossible.');
  return db.storage.from('brand').getPublicUrl(path).data.publicUrl;
}
