import { NextResponse, type NextRequest } from 'next/server';
import * as z from 'zod';
import { clientFingerprint } from '@/lib/access/hash';
import { createClient } from '@/lib/supabase/server';
import { readJsonBody } from '@/lib/validation/http';
import { FORM_ORIGINS } from '../origins';

// Books a private upload path for one file field of a published form
// (public_form_upload_reserve checks the field, type, size and limits). The
// browser then sends the file straight to the private bucket, which only
// accepts booked paths.

const Body = z.strictObject({
  field: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  name: z.string().max(200),
  mime: z.string().max(100),
  size: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^f[a-z0-9]{10}$/.test(id))
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = await readJsonBody(request, Body, {
    maxBytes: 4 * 1024,
    allowedOrigins: FORM_ORIGINS
  });
  if (!parsed.ok) return parsed.response;
  const db = await createClient();
  const { data, error } = await db.rpc('public_form_upload_reserve', {
    p_public_id: id,
    p_field_id: parsed.data.field,
    p_name: parsed.data.name,
    p_mime: parsed.data.mime,
    p_size: parsed.data.size,
    p_subject: clientFingerprint(request.headers)
  });
  if (error) {
    if (error.code === 'PT404') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (error.code === 'PT429') return NextResponse.json({ error: 'limit' }, { status: 429 });
    if (error.code === 'PT503') return NextResponse.json({ error: 'paused' }, { status: 503 });
    if (error.code === '22023') {
      const kind = /too large/i.test(error.message) ? 'size' : 'type';
      return NextResponse.json({ error: kind }, { status: 422 });
    }
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
  return NextResponse.json({ path: (data as { path: string }).path });
}
