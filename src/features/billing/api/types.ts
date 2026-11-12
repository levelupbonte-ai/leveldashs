/** Plan limit keys enforced or measured by the database (private.billing_limit_keys). */
export const LIMIT_KEYS = [
  'team_members',
  'assistant_requests_month',
  'media_mb',
  'websites',
  'emails_month'
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** Feature keys a plan can list (translated by `billing.features.*`). */
export const PLAN_FEATURES = [
  'website_hosting',
  'analytics',
  'forms_inbox',
  'ai_assistant',
  'custom_domain',
  'payments',
  'bookings',
  'seo_tools',
  'email_support',
  'priority_support',
  'dedicated_manager'
] as const;

/** null = unlimited (or not limited by this plan). */
export type PlanLimits = Partial<Record<LimitKey, number | null>>;

/** free: 0; set: a price; unset: "price to be set by LevelUp"; custom: price agreed for this organization. */
export type PriceState = 'free' | 'set' | 'unset' | 'custom';
export type BillingStatus = 'active' | 'trial' | 'past_due' | 'suspended';
export type ChargeKind = 'setup' | 'subscription' | 'one_off';
export type ChargeStatus = 'due' | 'paid' | 'void' | 'overdue';
export type DiscountKind = 'percent' | 'fixed';
/** How a charge was paid (recorded by staff, or `card` for an online payment). */
export const PAYMENT_METHODS = [
  'bank_transfer',
  'cash',
  'mobile_money',
  'card',
  'paypal',
  'other'
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** How a charge can be paid online (set up on the server): card, PayPal. */
export type OnlinePaymentMethod = 'card' | 'paypal';
export type ChargeDocumentKind = 'invoice' | 'receipt';
export type DiscountScope = 'subscription' | 'setup' | 'all';

export interface PlanSummary {
  key: string;
  name: string;
  description: string | null;
  features: string[];
  limits: PlanLimits;
  /** Owners and admins only (null otherwise). */
  price: number | null;
  currency: string | null;
  price_state: Exclude<PriceState, 'custom'> | null;
}

export interface UsageMeter {
  key: LimitKey;
  used: number;
  limit: number | null;
}

export interface ChargeRow {
  id: string;
  label: string;
  description: string | null;
  kind: ChargeKind;
  base_amount: number;
  discount_label: string | null;
  discount_amount: number;
  amount: number;
  currency: string;
  due_date: string | null;
  status: ChargeStatus;
  paid_at: string | null;
  payment_note: string | null;
  created_at: string;
  /** LU-2026-0001: sequential per issuer and year, assigned by the database. */
  invoice_number: string;
  /** YYYY-MM-DD (America/Toronto). */
  issued_on: string;
  payment_method: PaymentMethod | null;
  payment_reference: string | null;
  paid_amount: number | null;
}

export interface ActiveDiscount {
  id: string;
  label: string;
  kind: DiscountKind;
  value: number;
  currency: string | null;
  applies_to: DiscountScope;
  ends_at: string | null;
  code: boolean;
}

export interface MoneyAmount {
  currency: string;
  amount: number;
}

/** What owners and admins see on top of the plan (public.billing_summary). */
export interface BillingMoney {
  price: number | null;
  currency: string;
  price_state: PriceState;
  price_after_discount: number | null;
  subscription_discount: { label: string; amount: number } | null;
  next_due_date: string | null;
  note: string | null;
  discounts: ActiveDiscount[];
  charges: ChargeRow[];
  total_due: MoneyAmount[];
  overdue_count: number;
  /** LevelUp's business details are complete: invoices and receipts can be downloaded. */
  documents_ready: boolean;
}

export interface BillingSummary {
  can_manage: boolean;
  status: BillingStatus;
  plan: Omit<PlanSummary, 'price' | 'currency' | 'price_state'>;
  usage: UsageMeter[];
  plans: PlanSummary[];
  pending_request: { id: string; plan_key: string; created_at: string } | null;
  /** Null for editors and viewers: members see the plan, not the money. */
  money: BillingMoney | null;
}

/** This period's real counts (public.billing_usage). */
export interface BillingUsage {
  period_start: string;
  storage_bytes: number;
  media_files: number;
  chat_messages_month: number;
  assistant_requests_month: number;
  /** Campaign e-mails queued or sent plus test e-mails this month (null before the migration). */
  emails_month?: number;
  team_members: number;
  pending_invitations: number;
  websites: number;
}

export type RedeemResult =
  | { status: 'redeemed'; discount: ActiveDiscount }
  | { status: 'already_redeemed' }
  | { status: 'invalid' };

export interface UpgradeRequestResult {
  status: 'requested' | 'already';
}

/** public.billing_charge_document: what an invoice / receipt PDF shows. */
export interface ChargeDocument {
  charge: ChargeRow;
  organization: { id: string; name: string };
  issuer: {
    legal_name: string | null;
    address: string | null;
    email: string | null;
    tax_id: string | null;
  };
  issuer_ready: boolean;
  /** The reader is LevelUp staff (aal2). */
  staff: boolean;
}
