import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { getBillingSummary, getBillingUsage } from './service';

export const billingKeys = {
  all: ['billing'] as const,
  org: (organizationId: string) => [...billingKeys.all, organizationId] as const,
  summary: (organizationId: string) => [...billingKeys.org(organizationId), 'summary'] as const,
  usage: (organizationId: string) => [...billingKeys.org(organizationId), 'usage'] as const
};

export const billingSummaryQueryOptions = (db: SupabaseClient, organizationId: string) =>
  queryOptions({
    queryKey: billingKeys.summary(organizationId),
    queryFn: () => getBillingSummary(db, organizationId)
  });

export const billingUsageQueryOptions = (db: SupabaseClient, organizationId: string) =>
  queryOptions({
    queryKey: billingKeys.usage(organizationId),
    queryFn: () => getBillingUsage(db, organizationId),
    staleTime: 60 * 1000
  });
