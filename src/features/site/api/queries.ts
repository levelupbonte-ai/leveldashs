import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import type { CollectionDef } from '../config/collections';
import {
  getSeoSettings,
  getSiteOverview,
  getWebsiteIntegration,
  listAppointments,
  listCollection,
  listContentBlocks,
  listMedia,
  listSettings,
  listSubmissions,
  listWaitlist
} from './service';

// Query options take the Supabase client so the same keys work for the server
// prefetch (cookie-bound client) and the browser (session client).
export const siteKeys = {
  all: ['site'] as const,
  website: (websiteId: string) => [...siteKeys.all, websiteId] as const,
  collection: (websiteId: string, key: string) =>
    [...siteKeys.website(websiteId), 'collection', key] as const,
  appointments: (websiteId: string) => [...siteKeys.website(websiteId), 'appointments'] as const,
  waitlist: (websiteId: string) => [...siteKeys.website(websiteId), 'waitlist'] as const,
  submissions: (websiteId: string) => [...siteKeys.website(websiteId), 'submissions'] as const,
  media: (websiteId: string) => [...siteKeys.website(websiteId), 'media'] as const,
  settings: (websiteId: string) => [...siteKeys.website(websiteId), 'settings'] as const,
  blocks: (websiteId: string) => [...siteKeys.website(websiteId), 'blocks'] as const,
  overview: (websiteId: string) => [...siteKeys.website(websiteId), 'overview'] as const,
  integration: (websiteId: string) => [...siteKeys.website(websiteId), 'integration'] as const,
  seo: (websiteId: string) => [...siteKeys.website(websiteId), 'seo'] as const
};

export const collectionQueryOptions = (db: SupabaseClient, def: CollectionDef, websiteId: string) =>
  queryOptions({
    queryKey: siteKeys.collection(websiteId, def.key),
    queryFn: () => listCollection(db, def, websiteId)
  });

export const appointmentsQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: siteKeys.appointments(websiteId),
    queryFn: () => listAppointments(db, websiteId),
    staleTime: 15 * 1000
  });

export const waitlistQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: siteKeys.waitlist(websiteId),
    queryFn: () => listWaitlist(db, websiteId),
    staleTime: 10 * 1000,
    refetchInterval: 30 * 1000
  });

export const submissionsQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: siteKeys.submissions(websiteId),
    queryFn: () => listSubmissions(db, websiteId),
    staleTime: 15 * 1000
  });

export const mediaQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: siteKeys.media(websiteId),
    queryFn: () => listMedia(db, websiteId)
  });

export const settingsQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: siteKeys.settings(websiteId),
    queryFn: () => listSettings(db, websiteId)
  });

export const blocksQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: siteKeys.blocks(websiteId),
    queryFn: () => listContentBlocks(db, websiteId)
  });

export const overviewQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: siteKeys.overview(websiteId),
    queryFn: () => getSiteOverview(db, websiteId),
    staleTime: 30 * 1000
  });

export const integrationQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: siteKeys.integration(websiteId),
    queryFn: () => getWebsiteIntegration(db, websiteId),
    staleTime: 15 * 1000
  });

export const seoQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: siteKeys.seo(websiteId),
    queryFn: () => getSeoSettings(db, websiteId)
  });
