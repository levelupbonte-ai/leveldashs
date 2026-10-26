import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { siteKeys } from '@/features/site/api/queries';
import { listApiKeys } from './service';

export const apiKeyKeys = {
  all: (websiteId: string) => [...siteKeys.website(websiteId), 'api-keys'] as const,
  list: (websiteId: string) => [...apiKeyKeys.all(websiteId), 'list'] as const
};

export const apiKeysQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: apiKeyKeys.list(websiteId),
    queryFn: () => listApiKeys(db, websiteId)
  });
