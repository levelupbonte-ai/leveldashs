import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { siteKeys } from '@/features/site/api/queries';
import { listForms } from './service';

// Under siteKeys.website(id): site mutations refresh these too.
export const formKeys = {
  all: (websiteId: string) => [...siteKeys.website(websiteId), 'forms'] as const,
  list: (websiteId: string) => [...formKeys.all(websiteId), 'list'] as const
};

export const formsQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: formKeys.list(websiteId),
    queryFn: () => listForms(db, websiteId),
    staleTime: 30 * 1000
  });
