import { NextResponse, type NextRequest } from 'next/server';
import { getLocale } from 'next-intl/server';
import { getTranslatorFor } from '@/i18n/messages';
import { sendNotice } from '@/lib/email/notice';
import { getContract } from '@/features/contracts/api/service';
import { isSameOrigin, isUuid, LEVELUP_CONTACT } from '@/features/contracts/server/http';
import { contractPdfLabels } from '@/features/contracts/server/labels';
import {
  buildContractPdf,
  contractPdfFileName,
  contractPdfPath
} from '@/features/contracts/server/pdf';
import { createClient } from '@/lib/supabase/server';

// After sign_contract (called from the browser so the database records the
// signer's IP): archive the signed PDF in the private `contracts` bucket and
// e-mail it once to the signer and to LevelUp. Everything runs as the signed-in
// user; the database decides (storage policy, mark_contract_emailed).
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const db = await createClient();
  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const contract = await getContract(db, id).catch(() => null);
  if (!contract || contract.status !== 'signed' || !contract.signature) {
    return NextResponse.json({ error: 'not_signed' }, { status: 409 });
  }

  const locale = await getLocale();
  const pdf = await buildContractPdf(contract, await contractPdfLabels(locale));
  const fileName = contractPdfFileName(contract);

  // Archive copy, written once (no update policy): an existing file is kept.
  const upload = await db.storage
    .from('contracts')
    .upload(contractPdfPath(contract), new Blob([Buffer.from(pdf)], { type: 'application/pdf' }), {
      contentType: 'application/pdf',
      upsert: false
    });
  const stored = !upload.error || /exists|duplicate/i.test(upload.error.message);
  if (upload.error && !stored) console.error('contract pdf not archived', upload.error.message);

  // E-mail once per contract (the RPC returns true the first time only).
  const { data: first } = await db.rpc('mark_contract_emailed', { p_contract_id: id });
  let emailed = false;
  if (first === true) {
    const signature = contract.signature;
    const date = new Date(signature.signedAt).toISOString().replace('T', ' ').slice(0, 16);
    const organization = contract.orderForm.client ?? '';
    const { locale: signerLocale, t } = await getTranslatorFor(locale);
    const attachments = [{ filename: fileName, content: pdf }];
    emailed = await sendNotice({
      to: signature.signerEmail || user.email || '',
      locale: signerLocale,
      subject: t('emails.contract.signedSubject', { title: contract.title }),
      title: t('emails.contract.signedTitle'),
      lines: [
        t('emails.contract.signedLine1', {
          name: signature.signerName,
          title: contract.title,
          organization,
          date
        }),
        t('emails.contract.signedLine2')
      ],
      attachments
    });
    // Internal copy for LevelUp, always in English.
    const { t: en } = await getTranslatorFor('en');
    const team = await sendNotice({
      to: LEVELUP_CONTACT,
      locale: 'en',
      subject: en('emails.contract.teamSubject', { organization }),
      title: en('emails.contract.signedTitle'),
      lines: [
        en('emails.contract.signedLine1', {
          name: signature.signerName,
          title: contract.title,
          organization,
          date
        }),
        `Contract ID: ${contract.id}`,
        `SHA-256: ${signature.documentHash}`
      ],
      attachments
    });
    if (!emailed || !team) console.error('contract e-mail not sent', { signer: emailed, team });
  }
  return NextResponse.json({ stored, emailed });
}
