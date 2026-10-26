import 'server-only';
import { NextResponse } from 'next/server';
import { getLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { PATTERNS } from '@/lib/validation/sanitize';
import type { ChargeDocument, ChargeDocumentKind } from '../api/types';
import { chargePdfLabels } from './labels';
import { buildChargePdf, chargePdfFileName } from './pdf';

const json = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Invoice or receipt PDF of one charge, generated on every request from the
 * database record. The session and the membership are checked by
 * public.billing_charge_document (owners and admins of the charge's
 * organization, LevelUp staff on aal2); anyone else gets 404, the same answer
 * as an unknown id. Clients only get documents once LevelUp's business
 * details are complete; staff may preview them before (marked as a draft).
 */
export async function chargeDocumentResponse(id: string, kind: ChargeDocumentKind) {
  if (!PATTERNS.uuid.test(id)) return json(404, 'not_found');
  const db = await createClient();
  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) return json(401, 'unauthenticated');

  const { data, error } = await db.rpc('billing_charge_document', { p_id: id });
  if (error || !data) return json(404, 'not_found');
  const doc = data as ChargeDocument;
  if (!doc.issuer_ready && !doc.staff) return json(409, 'documents_not_ready');
  if (kind === 'receipt' && doc.charge.status !== 'paid') return json(404, 'not_paid');

  const labels = await chargePdfLabels(await getLocale(), doc, kind);
  const pdf = await buildChargePdf(doc, kind, labels);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${chargePdfFileName(labels.fileWord, doc.charge.invoice_number)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
