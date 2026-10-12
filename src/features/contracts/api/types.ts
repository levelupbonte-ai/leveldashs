// Client contracts (public.contracts / public.contract_signatures). Members read
// their organization's contracts once LevelUp sends them; owners and admins sign
// through the sign_contract RPC. See docs/contracts.md.

export type ContractStatus = 'draft' | 'sent' | 'signed' | 'void' | 'superseded';

export type { OrgAccessState, RequiredTask } from '@/lib/auth/types';

/** Order form filled by LevelUp (amounts in USD). */
export interface OrderForm {
  client?: string;
  projectName?: string;
  packageName?: string;
  scope?: string[];
  buildPrice?: number;
  paymentSchedule?: string;
  monthlyPlan?: string;
  monthlyPrice?: number;
  /** YYYY-MM-DD */
  startDate?: string;
  notes?: string;
}

export interface ContractSignature {
  id: string;
  signerName: string;
  signerTitle: string;
  signerEmail: string;
  signedAt: string;
  ip: string | null;
  userAgent: string | null;
  documentHash: string;
  /** SVG path data in a 600 x 200 box, or null when only typed. */
  drawnSignature: string | null;
}

export interface ContractSummary {
  id: string;
  organizationId: string;
  websiteId: string | null;
  title: string;
  templateVersion: number;
  status: ContractStatus;
  required: boolean;
  sentAt: string | null;
  signedAt: string | null;
}

export interface Contract extends ContractSummary {
  /** Language shown first to the client; the English text always prevails. */
  locale: 'en' | 'fr';
  /** Official English text (Markdown). */
  body: string;
  /** French translation (Markdown), for information. */
  translatedBody: string | null;
  orderForm: OrderForm;
  documentHash: string | null;
  emailedAt: string | null;
  signature: ContractSignature | null;
}

export interface SignContractInput {
  contractId: string;
  fullName: string;
  title: string;
  drawnSignature: string | null;
  consent: boolean;
  documentHash: string;
}

export interface FinalizeResult {
  stored: boolean;
  emailed: boolean;
}
