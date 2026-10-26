import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { siteKeys } from '@/features/site/api/queries';
import { listApiKeys, listDeveloperActivity } from './service';

export const apiKeyKeys = {
  all: (websiteId: string) => [...siteKeys.website(websiteId), 'api-keys'] as const,
  list: (websiteId: string) => [...apiKeyKeys.all(websiteId), 'list'] as const,
  activity: (websiteId: string) => [...apiKeyKeys.all(websiteId), 'activity'] as const
};

export const apiKeysQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: apiKeyKeys.list(websiteId),
    queryFn: () => listApiKeys(db, websiteId)
  });

export const developerActivityQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: apiKeyKeys.activity(websiteId),
    queryFn: () => listDeveloperActivity(db, websiteId)
  });
