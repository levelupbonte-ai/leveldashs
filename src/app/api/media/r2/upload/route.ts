import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { fields } from '@/lib/validation/fields';
import { errorResponse, readJsonBody } from '@/lib/validation/http';
import { deleteObjects, isR2Configured, presignPut } from '@/lib/r2/server';
import { createClient } from '@/lib/supabase/server';

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm'
};

const Body = z.strictObject({
  websiteId: fields.websiteId({ required: true }),
  ext: z.enum(Object.keys(EXT_MIME) as [string, ...string[]]),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
  thumbBytes: z
    .number()
    .int()
    .min(0)
    .max(2 * 1024 * 1024)
    .default(0)
});

/**
 * Books an upload (database: editor role, type, size, plan quota, rate limit)
 * and returns PUT URLs signed for exactly that path, type and size. Also
 * deletes the objects of the organization's bookings abandoned for an hour.
 */
export async function POST(request: NextRequest) {
  if (!isR2Configured()) return errorResponse(503, 'unavailable');
  const parsed = await readJsonBody(request, Body, { maxBytes: 512 });
  if (!parsed.ok) return parsed.response;
  const { websiteId, ext, bytes, thumbBytes } = parsed.data;
  const mime = EXT_MIME[ext];

  const db = await createClient();
  const { data, error } = await db.rpc('media_r2_reserve', {
    p_website_id: websiteId,
    p_ext: ext,
    p_mime: mime,
    p_bytes: bytes,
    p_thumb_bytes: thumbBytes
  });
  if (error) {
    // Plan limit: the database's own answer (key, limit, plan) for the usual
    // "upgrade" message. Everything else is a plain code.
    if (error.code === 'PT402') {
      return NextResponse.json(
        {
          error: 'plan_limit',
          db: { message: error.message, code: error.code, details: error.details }
        },
        { status: 402 }
      );
    }
    const code =
      error.code === 'PT429'
        ? 'rate_limited'
        : error.code === '42501' || error.code === 'PT401'
          ? 'forbidden'
          : 'invalid';
    return errorResponse(code === 'forbidden' ? 403 : code === 'rate_limited' ? 429 : 400, code);
  }
  const booking = data as {
    path: string;
    thumb_path: string | null;
    expired: { path: string; thumb_path: string | null }[];
  };
  await deleteObjects(booking.expired.flatMap((e) => [e.path, e.thumb_path ?? '']));

  const [url, thumbUrl] = await Promise.all([
    presignPut(booking.path, mime, bytes),
    booking.thumb_path ? presignPut(booking.thumb_path, 'image/webp', thumbBytes) : null
  ]);
  return NextResponse.json(
    { path: booking.path, thumbPath: booking.thumb_path, url, thumbUrl },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
