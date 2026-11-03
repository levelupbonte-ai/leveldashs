import type { AssistantAttachment } from '../types';

/** Same caps as the server (src/features/assistant/server/attachments.ts). */
export const ASSISTANT_MAX_FILES = 3;
export const ASSISTANT_MAX_BYTES = 1_200_000;
const MAX_EDGE = 1600;

export const ASSISTANT_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,text/markdown,application/json,.txt,.csv,.md,.json';

const TEXT_TYPES: Record<string, string> = {
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json'
};

export type PreparedFile = AssistantAttachment & {
  /** Object URL for the preview chip (images only). */
  preview: string | null;
  kind: 'image' | 'pdf' | 'text';
};

export type PrepareError = 'type' | 'size' | 'unreadable';

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Photos and screenshots: resized (long edge 1600 px) and re-encoded as JPEG, metadata dropped. */
async function shrinkImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif' && file.size <= ASSISTANT_MAX_BYTES) return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    for (const quality of [0.82, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality)
      );
      if (blob && blob.size <= ASSISTANT_MAX_BYTES) return blob;
    }
    throw new Error('too large');
  } finally {
    bitmap.close();
  }
}

/** A picked, pasted or dropped file, ready to send (or the reason it cannot be). */
export async function prepareFile(file: File): Promise<PreparedFile | PrepareError> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  try {
    if (file.type.startsWith('image/')) {
      if (!/^image\/(png|jpeg|webp|gif|heic|heif|avif)$/.test(file.type)) return 'type';
      const blob = await shrinkImage(file).catch(() => null);
      if (!blob) return 'unreadable';
      if (blob.size > ASSISTANT_MAX_BYTES) return 'size';
      const mime = blob.type || 'image/jpeg';
      const name = file.name.replace(/\.[^.]+$/, '') + (mime === 'image/gif' ? '.gif' : '.jpg');
      return {
        name,
        mime,
        data: toBase64(await blob.arrayBuffer()),
        preview: URL.createObjectURL(blob),
        kind: 'image'
      };
    }
    if (file.type === 'application/pdf' || ext === 'pdf') {
      if (file.size > ASSISTANT_MAX_BYTES) return 'size';
      return {
        name: file.name,
        mime: 'application/pdf',
        data: toBase64(await file.arrayBuffer()),
        preview: null,
        kind: 'pdf'
      };
    }
    const textType =
      TEXT_TYPES[ext] ?? (Object.values(TEXT_TYPES).includes(file.type) ? file.type : null);
    if (textType) {
      if (file.size > 200_000) return 'size';
      return {
        name: file.name,
        mime: textType,
        data: toBase64(await file.arrayBuffer()),
        preview: null,
        kind: 'text'
      };
    }
    return 'type';
  } catch {
    return 'unreadable';
  }
}
