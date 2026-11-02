import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { siteKeys } from '@/features/site/api/queries';
import { getPortalOverview, getPortalThread } from './service';

export const portalKeys = {
  all: (websiteId: string) => [...siteKeys.website(websiteId), 'client-portal'] as const,
  list: (websiteId: string) => [...portalKeys.all(websiteId), 'overview'] as const,
  detail: (websiteId: string, customerId: string) =>
    [...portalKeys.all(websiteId), 'thread', customerId] as const
};

export const portalOverviewQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: portalKeys.list(websiteId),
    queryFn: () => getPortalOverview(db, websiteId),
    staleTime: 30 * 1000
  });

export const portalThreadQueryOptions = (
  db: SupabaseClient,
  websiteId: string,
  customerId: string
) =>
  queryOptions({
    queryKey: portalKeys.detail(websiteId, customerId),
    queryFn: () => getPortalThread(db, customerId),
    staleTime: 10 * 1000
  });
