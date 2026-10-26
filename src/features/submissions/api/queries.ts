import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { siteKeys } from '@/features/site/api/queries';
import { listSubmissionPage } from './service';
import type { SubmissionFilters } from './types';

// Under siteKeys.submissions: useSiteMutations().updateSubmission refreshes it.
export const submissionKeys = {
  all: (websiteId: string) => siteKeys.submissions(websiteId),
  list: (websiteId: string, filters: SubmissionFilters) =>
    [...submissionKeys.all(websiteId), 'inbox', filters] as const
};

export const submissionPageQueryOptions = (
  db: SupabaseClient,
  websiteId: string,
  filters: SubmissionFilters
) =>
  queryOptions({
    queryKey: submissionKeys.list(websiteId, filters),
    queryFn: () => listSubmissionPage(db, websiteId, filters),
    staleTime: 15 * 1000
  });
