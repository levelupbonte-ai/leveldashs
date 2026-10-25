import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { siteKeys } from '@/features/site/api/queries';
import type { RangeDays } from '@/features/insights/api/types';
import { getPaymentDetail, getPaymentsSummary, listPayments } from './service';
import type { PaymentFilters } from './types';

export const paymentKeys = {
  all: (websiteId: string) => [...siteKeys.website(websiteId), 'payments'] as const,
  list: (websiteId: string, filters: PaymentFilters) =>
    [...paymentKeys.all(websiteId), 'list', filters] as const,
  summary: (websiteId: string, days: RangeDays, live: boolean) =>
    [...paymentKeys.all(websiteId), 'summary', days, live] as const,
  detail: (websiteId: string, id: string) => [...paymentKeys.all(websiteId), 'detail', id] as const
};

export const paymentsQueryOptions = (
  db: SupabaseClient,
  websiteId: string,
  filters: PaymentFilters
) =>
  queryOptions({
    queryKey: paymentKeys.list(websiteId, filters),
    queryFn: () => listPayments(db, websiteId, filters),
    staleTime: 30 * 1000
  });

export const paymentsSummaryQueryOptions = (
  db: SupabaseClient,
  websiteId: string,
  days: RangeDays,
  live: boolean
) =>
  queryOptions({
    queryKey: paymentKeys.summary(websiteId, days, live),
    queryFn: () => getPaymentsSummary(db, websiteId, days, live),
    staleTime: 30 * 1000
  });

export const paymentDetailQueryOptions = (db: SupabaseClient, websiteId: string, id: string) =>
  queryOptions({
    queryKey: paymentKeys.detail(websiteId, id),
    queryFn: () => getPaymentDetail(db, id)
  });
