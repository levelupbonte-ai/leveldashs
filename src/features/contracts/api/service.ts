import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, isMfaError } from '@/lib/errors';
import type {
  Contract,
  ContractSignature,
  ContractStatus,
  ContractSummary,
  FinalizeResult,
  OrderForm,
  SignContractInput
} from './types';

const SUMMARY =
  'id, organization_id, website_id, title, template_version, status, required, sent_at, signed_at';

type SummaryRow = {
  id: string;
  organization_id: string;
  website_id: string | null;
  title: string;
  template_version: number;
  status: ContractStatus;
  required: boolean;
  sent_at: string | null;
  signed_at: string | null;
};

type SignatureRow = {
  id: string;
  signer_name: string;
  signer_title: string;
  signer_email: string;
  signed_at: string;
  ip: string | null;
  user_agent: string | null;
  document_hash: string;
  drawn_signature: string | null;
};

function toSummary(row: SummaryRow): ContractSummary {
  return {
    id: row.id,
    organizationId: row.organization_id,
    websiteId: row.website_id,
    title: row.title,
    templateVersion: row.template_version,
    status: row.status,
    required: row.required,
    sentAt: row.sent_at,
    signedAt: row.signed_at
  };
}

export function toSignature(row: SignatureRow | null | undefined): ContractSignature | null {
  if (!row) return null;
  return {
    id: row.id,
    signerName: row.signer_name,
    signerTitle: row.signer_title,
    signerEmail: row.signer_email,
    signedAt: row.signed_at,
    ip: row.ip,
    userAgent: row.user_agent,
    documentHash: row.document_hash,
    drawnSignature: row.drawn_signature
  };
}

/** Contracts LevelUp sent to the organization (waiting, signed, earlier versions). */
export async function listContracts(
  db: SupabaseClient,
  organizationId: string
): Promise<ContractSummary[]> {
  const { data, error } = await db
    .from('contracts')
    .select(SUMMARY)
    .eq('organization_id', organizationId)
    .in('status', ['sent', 'signed', 'superseded'])
    .order('sent_at', { ascending: false });
  if (error) throw new AppError('loadFailed', { cause: error });
  return ((data ?? []) as SummaryRow[]).map(toSummary);
}

/** One contract with its frozen text, order form and signature certificate. */
export async function getContract(db: SupabaseClient, id: string): Promise<Contract | null> {
  const { data, error } = await db
    .from('contracts')
    .select(
      `${SUMMARY}, locale, body, translated_body, order_form, document_hash, emailed_at,
       contract_signatures (id, signer_name, signer_title, signer_email, signed_at, ip, user_agent, document_hash, drawn_signature)`
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new AppError('loadFailed', { cause: error });
  if (!data) return null;
  const row = data as SummaryRow & {
    locale: 'en' | 'fr';
    body: string;
    translated_body: string | null;
    order_form: OrderForm | null;
    document_hash: string | null;
    emailed_at: string | null;
    contract_signatures: SignatureRow | SignatureRow[] | null;
  };
  const signature = Array.isArray(row.contract_signatures)
    ? row.contract_signatures[0]
    : row.contract_signatures;
  return {
    ...toSummary(row),
    locale: row.locale,
    body: row.body,
    translatedBody: row.translated_body,
    orderForm: row.order_form ?? {},
    documentHash: row.document_hash,
    emailedAt: row.emailed_at,
    signature: toSignature(signature)
  };
}

/** The contract to show first: the one waiting for a signature, else the latest signed. */
export function pickCurrent(contracts: ContractSummary[]): ContractSummary | null {
  return (
    contracts.find((c) => c.status === 'sent') ??
    contracts.find((c) => c.status === 'signed') ??
    null
  );
}

/**
 * Signs in the browser, so the database records the signer's own IP address and
 * user agent (request headers of this call).
 */
export async function signContract(db: SupabaseClient, input: SignContractInput) {
  const { data, error } = await db.rpc('sign_contract', {
    p_contract_id: input.contractId,
    p_full_name: input.fullName,
    p_title: input.title,
    p_drawn_signature: input.drawnSignature,
    p_consent: input.consent,
    p_document_hash: input.documentHash
  });
  if (error) {
    if (isMfaError(error)) throw new AppError('mfaRequired', { cause: error });
    if (error.code === 'PT409') {
      throw new AppError(
        error.message.includes('changed') ? 'contractChanged' : 'contractNotSignable',
        { cause: error }
      );
    }
    if (error.code === 'PT403') throw new AppError('forbidden', { cause: error });
    if (error.code === '22023') throw new AppError('invalidValues', { cause: error });
    throw new AppError('signFailed', { cause: error });
  }
  return data as { signature_id: string; signed_at: string };
}

/** After signing: archive the PDF and e-mail the signed copy (server route). */
export async function finalizeContract(id: string): Promise<FinalizeResult> {
  try {
    const res = await fetch(`/api/contracts/${encodeURIComponent(id)}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!res.ok) return { stored: false, emailed: false };
    return (await res.json()) as FinalizeResult;
  } catch {
    return { stored: false, emailed: false };
  }
}

export const contractPdfUrl = (id: string) => `/api/contracts/${encodeURIComponent(id)}/pdf`;
