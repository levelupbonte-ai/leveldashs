import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { getAiInsights, listProjectRequests } from './service';

export const adminInsightKeys = {
  all: ['platform-admin'] as const,
  ai: () => [...adminInsightKeys.all, 'ai'] as const,
  projectRequests: () => [...adminInsightKeys.all, 'project-requests'] as const
};

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
