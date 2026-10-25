export const PAYMENT_STATUSES = ['paid', 'pending', 'failed', 'refunded', 'expired'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_SORTS = ['occurred_at', 'amount', 'status', 'offer_name', 'customer'] as const;
export type PaymentSort = (typeof PAYMENT_SORTS)[number];

/** One payment as returned by site_payments_list (amount in minor units). */
export interface Payment {
  id: string;
  provider: 'stripe';
  livemode: boolean;
  provider_session_id: string;
  provider_payment_intent: string | null;
  status: PaymentStatus;
  amount: number;
  currency: string;
  offer_id: string | null;
  offer_name: string | null;
  /** Masked (j***@e***.com) for viewers. */
  customer_email: string | null;
  customer_name: string | null;
  masked: boolean;
  occurred_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentEvent {
  provider_event_id: string;
  status: PaymentStatus;
  amount: number | null;
  applied: boolean;
  occurred_at: string | null;
  received_at: string;
}

export interface PaymentDetail extends Payment {
  metadata: Record<string, unknown>;
  events: PaymentEvent[];
}

export interface PaymentFilters {
  page: number;
  perPage: number;
  search: string | null;
  status: PaymentStatus[];
  sort: PaymentSort;
  desc: boolean;
  /** false shows the test payments (lu_test_ keys) instead of the live ones. */
  live: boolean;
}

export interface PaymentPage {
  rows: Payment[];
  total: number;
  /** The caller sees customer details (editor and above). */
  pii: boolean;
}
