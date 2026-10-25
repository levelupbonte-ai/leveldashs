import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { siteKeys } from '@/features/site/api/queries';
import { listProjectRequests } from './service';
import type { ProjectRequestFilters } from './types';

export const projectRequestKeys = {
  all: (websiteId: string) => [...siteKeys.website(websiteId), 'project-requests'] as const,
  list: (websiteId: string, filters: ProjectRequestFilters) =>
    [...projectRequestKeys.all(websiteId), 'list', filters] as const
};

export const projectRequestsQueryOptions = (
  db: SupabaseClient,
  websiteId: string,
  filters: ProjectRequestFilters
) =>
  queryOptions({
    queryKey: projectRequestKeys.list(websiteId, filters),
    queryFn: () => listProjectRequests(db, websiteId, filters),
    staleTime: 30 * 1000
  });
