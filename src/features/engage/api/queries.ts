import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { siteKeys } from '@/features/site/api/queries';
import { getCampaigns, getConfigValues, getPromoCodes } from './service';

export const engageKeys = {
  all: (websiteId: string) => [...siteKeys.website(websiteId), 'engage'] as const,
  campaigns: (websiteId: string) => [...engageKeys.all(websiteId), 'campaigns'] as const,
  config: (websiteId: string) => [...engageKeys.all(websiteId), 'config'] as const,
  promos: (websiteId: string) => [...engageKeys.all(websiteId), 'promos'] as const
};

export const campaignsListQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: engageKeys.campaigns(websiteId),
    queryFn: () => getCampaigns(db, websiteId),
    staleTime: 30 * 1000
  });

export const configValuesQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: engageKeys.config(websiteId),
    queryFn: () => getConfigValues(db, websiteId),
    staleTime: 30 * 1000
  });

export const promoCodesQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: engageKeys.promos(websiteId),
    queryFn: () => getPromoCodes(db, websiteId),
    staleTime: 30 * 1000
  });
