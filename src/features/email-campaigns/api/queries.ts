import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { siteKeys } from '@/features/site/api/queries';
import { getCampaign, getEmailOverview, listCampaigns, listContacts } from './service';
import type { ContactFilters } from './types';

export const emailKeys = {
  all: (websiteId: string) => [...siteKeys.website(websiteId), 'email'] as const,
  overview: (websiteId: string) => [...emailKeys.all(websiteId), 'overview'] as const,
  list: (websiteId: string) => [...emailKeys.all(websiteId), 'campaigns'] as const,
  detail: (websiteId: string, id: string) => [...emailKeys.all(websiteId), 'campaign', id] as const,
  contacts: (websiteId: string, filters: ContactFilters) =>
    [...emailKeys.all(websiteId), 'contacts', filters] as const
};

export const emailOverviewQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: emailKeys.overview(websiteId),
    queryFn: () => getEmailOverview(db, websiteId),
    staleTime: 30 * 1000
  });

export const campaignsQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: emailKeys.list(websiteId),
    queryFn: () => listCampaigns(db, websiteId),
    staleTime: 15 * 1000
  });

export const campaignQueryOptions = (db: SupabaseClient, websiteId: string, id: string) =>
  queryOptions({
    queryKey: emailKeys.detail(websiteId, id),
    queryFn: () => getCampaign(db, id)
  });

export const contactsQueryOptions = (
  db: SupabaseClient,
  websiteId: string,
  filters: ContactFilters
) =>
  queryOptions({
    queryKey: emailKeys.contacts(websiteId, filters),
    queryFn: () => listContacts(db, websiteId, filters),
    staleTime: 30 * 1000
  });
