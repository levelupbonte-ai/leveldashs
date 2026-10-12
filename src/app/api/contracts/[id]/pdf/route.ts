import { NextResponse, type NextRequest } from 'next/server';
import { getLocale } from 'next-intl/server';
import { getContract } from '@/features/contracts/api/service';
import { isUuid } from '@/features/contracts/server/http';
import { contractPdfLabels } from '@/features/contracts/server/labels';
import { buildContractPdf, contractPdfFileName } from '@/features/contracts/server/pdf';
import { createClient } from '@/lib/supabase/server';

// Signed copy (or a review copy before signature) of a contract the signed-in
// user can read (RLS). Always generated from the stored snapshot and signature,
// so the download matches the database record exactly.
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const db = await createClient();
  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const contract = await getContract(db, id).catch(() => null);
  if (!contract) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const pdf = await buildContractPdf(contract, await contractPdfLabels(await getLocale()));
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${contractPdfFileName(contract)}"`,
      'Cache-Control': 'private, no-store'
    }
  });
}
