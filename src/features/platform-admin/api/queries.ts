import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { listAccessRequests, listAllWebsites, listFeatures } from './clients';
import { getAiInsights, listProjectRequests } from './service';

export const adminInsightKeys = {
  all: ['platform-admin'] as const,
  ai: () => [...adminInsightKeys.all, 'ai'] as const,
  projectRequests: () => [...adminInsightKeys.all, 'project-requests'] as const,
  allWebsites: () => [...adminInsightKeys.all, 'all-websites'] as const,
  features: () => [...adminInsightKeys.all, 'features'] as const,
  accessRequests: () => [...adminInsightKeys.all, 'access-requests'] as const
};

export const allWebsitesQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminInsightKeys.allWebsites(),
    queryFn: () => listAllWebsites(db)
  });

export const featuresQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminInsightKeys.features(),
    queryFn: () => listFeatures(db),
    staleTime: 10 * 60 * 1000
  });

export const accessRequestsQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminInsightKeys.accessRequests(),
    queryFn: () => listAccessRequests(db)
  });

export const aiInsightsQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminInsightKeys.ai(),
    queryFn: () => getAiInsights(db),
    staleTime: 60 * 1000
  });

export const projectRequestsQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminInsightKeys.projectRequests(),
    queryFn: () => listProjectRequests(db)
  });
