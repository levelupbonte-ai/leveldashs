import type { NextRequest } from 'next/server';
import { chargeDocumentResponse } from '@/features/billing/server/documents';

// Receipt PDF of a charge (owners and admins of its organization, LevelUp staff).
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return chargeDocumentResponse(id, 'receipt');
}
