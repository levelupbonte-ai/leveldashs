import { AppError } from '@/lib/errors';

/**
 * Browser-side image optimization before an upload to the media library:
 * - resized so the long edge is at most MEDIA_MAX_EDGE (never enlarged);
 * - re-encoded to WebP (JPEG or PNG when the browser cannot encode WebP, e.g. Safari);
 * - re-encoding through a canvas drops every metadata block (EXIF, GPS, XMP, ICC);
 * - EXIF orientation is applied first, so photos stay upright;
 * - GIF keeps its original bytes (animation) and only gets a thumbnail.
 * SVG is never accepted by the library (it can carry scripts).
 * A small WebP thumbnail is generated for the library grid (the Free plan has
 * no on-the-fly image transformations).
 */

export const MEDIA_MAX_EDGE = 2400;
export const THUMB_MAX_EDGE = 512;
/** Decoding guard: ~50 megapixels (a 8000 x 6000 photo is 48). */
export const MAX_PIXELS = 50_000_000;
const QUALITY = 0.86;
const THUMB_QUALITY = 0.8;

export interface OptimizedImage {
  blob: Blob;
  type: string;
  width: number;
  height: number;
  /** WebP thumbnail, or null when the browser cannot encode WebP. */
  thumb: Blob | null;
}

/** Size that fits in a `max` x `max` box, keeping the ratio, never enlarging. */
export function fitWithin(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

/** Format to use when WebP encoding is not available. */
export function fallbackType(hasAlpha: boolean): 'image/png' | 'image/jpeg' {
  return hasAlpha ? 'image/png' : 'image/jpeg';
}

function draw(bitmap: ImageBitmap, max: number, opaque: boolean) {
  const size = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new AppError('imageUnreadable');
  if (opaque) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  return { canvas, ctx, ...size };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

export async function optimizeImage(file: File): Promise<OptimizedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (cause) {
    throw new AppError('imageUnreadable', { cause });
  }
  try {
    if (bitmap.width * bitmap.height > MAX_PIXELS) throw new AppError('mediaImageTooLarge');

    const thumbCanvas = draw(bitmap, THUMB_MAX_EDGE, false).canvas;
    const thumbBlob = await toBlob(thumbCanvas, 'image/webp', THUMB_QUALITY);
    const thumb = thumbBlob?.type === 'image/webp' ? thumbBlob : null;

    if (file.type === 'image/gif') {
      return { blob: file, type: file.type, width: bitmap.width, height: bitmap.height, thumb };
    }

    const main = draw(bitmap, MEDIA_MAX_EDGE, false);
    let blob = await toBlob(main.canvas, 'image/webp', QUALITY);
    if (!blob || blob.type !== 'image/webp') {
      const type = fallbackType(hasTransparency(main.ctx, main.width, main.height));
      const canvas =
        type === 'image/jpeg' ? draw(bitmap, MEDIA_MAX_EDGE, true).canvas : main.canvas;
      blob = await toBlob(canvas, type, QUALITY);
    }
    if (!blob) throw new AppError('imageUnreadable');
    return { blob, type: blob.type, width: main.width, height: main.height, thumb };
  } finally {
    bitmap.close();
  }
}
