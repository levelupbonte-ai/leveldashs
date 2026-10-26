import type { SupabaseClient } from '@supabase/supabase-js';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { CollectionDef } from '../config/collections';
import type { MediaCursor, MediaFilters } from './types';
import {
  getSeoSettings,
  getWebsiteIntegration,
  listAppointments,
  listCollection,
  listContentBlocks,
  getMediaStats,
  listMedia,
  listSettings,
  listWaitlist,
  PAGE_SIZE,
  type AppointmentView
} from './service';

const nextPage = <T>(last: T[], all: T[][]) => (last.length === PAGE_SIZE ? all.length : undefined);

// Query options take the Supabase client so the same keys work for the server
// prefetch (cookie-bound client) and the browser (session client).
export const siteKeys = {
  all: ['site'] as const,
  website: (websiteId: string) => [...siteKeys.all, websiteId] as const,
  collection: (websiteId: string, key: string) =>
    [...siteKeys.website(websiteId), 'collection', key] as const,
  appointments: (websiteId: string, view?: AppointmentView) =>
    [...siteKeys.website(websiteId), 'appointments', ...(view ? [view] : [])] as const,
  waitlist: (websiteId: string) => [...siteKeys.website(websiteId), 'waitlist'] as const,
  submissions: (websiteId: string, view?: string) =>
    [...siteKeys.website(websiteId), 'submissions', ...(view ? [view] : [])] as const,
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

export const appointmentsQueryOptions = (
  db: SupabaseClient,
  websiteId: string,
  view: AppointmentView = 'upcoming'
) =>
  infiniteQueryOptions({
    queryKey: siteKeys.appointments(websiteId, view),
    queryFn: ({ pageParam }) => listAppointments(db, websiteId, view, pageParam),
    initialPageParam: 0,
    getNextPageParam: nextPage,
    staleTime: 15 * 1000
  });

export const waitlistQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: siteKeys.waitlist(websiteId),
    queryFn: () => listWaitlist(db, websiteId),
    staleTime: 10 * 1000,
    refetchInterval: 30 * 1000
  });

export const mediaKeys = {
  all: (websiteId: string) => siteKeys.media(websiteId),
  list: (websiteId: string, filters: MediaFilters) =>
    [...siteKeys.media(websiteId), 'list', filters] as const,
  stats: (websiteId: string) => [...siteKeys.media(websiteId), 'stats'] as const
};

export const mediaQueryOptions = (db: SupabaseClient, websiteId: string, filters: MediaFilters) =>
  infiniteQueryOptions({
    queryKey: mediaKeys.list(websiteId, filters),
    queryFn: ({ pageParam }) => listMedia(db, websiteId, filters, pageParam),
    initialPageParam: null as MediaCursor | null,
    getNextPageParam: (last) => last.next ?? undefined
  });

export const mediaStatsQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: mediaKeys.stats(websiteId),
    queryFn: () => getMediaStats(db, websiteId)
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
