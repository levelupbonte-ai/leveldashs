import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, readJsonBody } from '@/lib/validation/http';
import { deleteObjects, isR2Configured } from '@/lib/r2/server';
import { createClient } from '@/lib/supabase/server';

const Body = z.strictObject({ id: z.string().uuid() });

/** Removes an R2 media file: the database checks the role, then the objects go. */
export async function POST(request: NextRequest) {
  if (!isR2Configured()) return errorResponse(503, 'unavailable');
  const parsed = await readJsonBody(request, Body, { maxBytes: 256 });
  if (!parsed.ok) return parsed.response;
  const db = await createClient();
  const { data, error } = await db.rpc('media_r2_delete', { p_id: parsed.data.id });
  if (error) return errorResponse(403, 'forbidden');
  const row = data as { path: string; thumb_path: string | null };
  await deleteObjects([row.path, row.thumb_path ?? '']);
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
