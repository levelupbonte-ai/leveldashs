import { AppError } from '@/lib/errors';

/**
 * Upload guard: the browser's `file.type` comes from the file name, so a renamed
 * HTML/SVG file would pass as an image. The first bytes (magic numbers) must match
 * an allowed format, and that format must be the one declared. SVG is never
 * accepted (it can carry scripts); storage buckets also allow-list MIME types and
 * cap sizes server-side (`brand` 2 MB, `media` 10 MB).
 */

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

/** ISO-BMFF brands (major + compatible) of an `ftyp` box, or null. */
function ftypBrands(bytes: Uint8Array): string[] | null {
  if (ascii(bytes, 4, 4) !== 'ftyp') return null;
  const size = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  const end = Math.min(bytes.length, size > 16 ? size : 32);
  const brands = [ascii(bytes, 8, 4)];
  for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(bytes, i, 4));
  return brands;
}

/** The real type of a file from its first bytes, or null when not recognised. */
export function sniffMimeType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  const brands = ftypBrands(bytes);
  if (brands) {
    if (brands.some((b) => b === 'avif' || b === 'avis')) return 'image/avif';
    // HEIC/HEIF photos are not supported by browsers: refuse rather than mislabel.
    if (brands.some((b) => /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(b))) return null;
    return 'video/mp4';
  }
  return null;
}

/** Reads the first bytes of `file` and checks them against `allowed`. */
export async function assertFileSignature(
  file: Blob,
  allowed: readonly string[],
  error: 'imageFormat' | 'mediaFormat'
): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const sniffed = sniffMimeType(head);
  const declared = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  if (!sniffed || !allowed.includes(sniffed) || sniffed !== declared) throw new AppError(error);
  return sniffed;
}
