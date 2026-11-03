import type { FormField } from '../api/types';

/** Same limits as the database (public_form_upload_reserve) and the private bucket. */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 2000;

const DOCUMENTS: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

/**
 * A visitor's file, ready to upload: photos resized (long edge 2000 px) and
 * re-encoded as JPEG (this also drops location data and turns iPhone HEIC
 * photos into JPEG); documents kept as they are (PDF, Word, text).
 */
export async function prepareUpload(
  file: File,
  accept: NonNullable<FormField['accept']>
): Promise<{ blob: Blob; name: string } | 'type' | 'size' | 'failed'> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isImage = file.type.startsWith('image/') || /^(jpe?g|png|webp|gif|heic|heif)$/.test(ext);
  if (isImage) {
    if (accept === 'document') return 'type';
    if (file.type === 'image/gif' && file.size <= UPLOAD_MAX_BYTES)
      return { blob: file, name: file.name };
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return 'failed';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85)
      );
      if (!blob) return 'failed';
      if (blob.size > UPLOAD_MAX_BYTES) return 'size';
      return { blob, name: `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg` };
    } catch {
      return 'failed';
    }
  }
  if (accept === 'image') return 'type';
  const mime = DOCUMENTS[ext];
  if (!mime) return 'type';
  if (file.size > UPLOAD_MAX_BYTES) return 'size';
  return { blob: new Blob([file], { type: mime }), name: file.name };
}
