import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral
} from 'nuqs/server';
import { rangeParser } from '@/features/insights/lib/range';
import {
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_SORTS,
  PAYMENT_STATUSES,
  type PaymentFilters
} from '../api/types';

/**
 * URL state of the payments page, shared by the server cache
 * (`src/lib/searchparams.ts`) and the client (`useQueryStates`): both map it
 * with `toPaymentFilters`, so they build the same query key.
 */
export const paymentParams = {
  range: rangeParser,
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(20),
  q: parseAsString.withDefault(''),
  status: parseAsArrayOf(parseAsStringLiteral(PAYMENT_STATUSES)).withDefault([]),
  provider: parseAsArrayOf(parseAsStringLiteral(PAYMENT_PROVIDERS)).withDefault([]),
  method: parseAsArrayOf(parseAsStringLiteral(PAYMENT_METHODS)).withDefault([]),
  sort: parseAsStringLiteral(PAYMENT_SORTS).withDefault('occurred_at'),
  asc: parseAsBoolean.withDefault(false),
  test: parseAsBoolean.withDefault(false)
};

export interface PaymentParams {
  page: number;
  perPage: number;
  q: string;
  status: PaymentFilters['status'];
  provider: PaymentFilters['provider'];
  method: PaymentFilters['method'];
  sort: PaymentFilters['sort'];
  asc: boolean;
  test: boolean;
}

export function toPaymentFilters(params: PaymentParams): PaymentFilters {
  return {
    page: Math.max(1, Math.min(params.page, 5000)),
    perPage: [10, 20, 50, 100].includes(params.perPage) ? params.perPage : 20,
    search: params.q.trim().slice(0, 100) || null,
    status: params.status,
    provider: params.provider,
    method: params.method,
    sort: params.sort,
    desc: !params.asc,
    live: !params.test
  };
}
