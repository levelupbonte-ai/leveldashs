import type { PaymentMethod, PaymentProvider, PaymentStatus } from '@/lib/validation/site-events';

export {
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentStatus
} from '@/lib/validation/site-events';

export const PAYMENT_SORTS = [
  'occurred_at',
  'amount',
  'status',
  'offer_name',
  'customer',
  'provider'
] as const;
export type PaymentSort = (typeof PAYMENT_SORTS)[number];

/** One payment as returned by site_payments_list (amount in minor units). */
export interface Payment {
  id: string;
  provider: PaymentProvider;
  /** card, mobile_money, … or null when the website did not say. */
  method: PaymentMethod | null;
  livemode: boolean;
  /** The provider's payment / session / transaction id. */
  provider_payment_id: string;
  /** A second id at the provider (payment intent, tx_ref, …). */
  provider_reference: string | null;
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
  provider: PaymentProvider;
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
  provider: PaymentProvider[];
  method: PaymentMethod[];
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
