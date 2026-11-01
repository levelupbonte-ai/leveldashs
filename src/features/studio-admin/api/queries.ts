import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import {
  getStudioSitePreview,
  getStudioTemplatePreview,
  listStudioSites,
  listStudioTemplates
} from './service';
import type { StudioSiteFilters } from './types';

export const studioAdminKeys = {
  all: ['studio-admin'] as const,
  templates: () => [...studioAdminKeys.all, 'templates'] as const,
  sites: () => [...studioAdminKeys.all, 'sites'] as const,
  siteList: (filters: StudioSiteFilters) => [...studioAdminKeys.sites(), 'list', filters] as const,
  preview: (kind: 'template' | 'site', id: string) =>
    [...studioAdminKeys.all, 'preview', kind, id] as const
};

export const studioTemplatesQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: studioAdminKeys.templates(),
    queryFn: () => listStudioTemplates(db),
    staleTime: 60 * 1000
  });

export const studioSitesQueryOptions = (db: SupabaseClient, filters: StudioSiteFilters) =>
  queryOptions({
    queryKey: studioAdminKeys.siteList(filters),
    queryFn: () => listStudioSites(db, filters),
    staleTime: 30 * 1000
  });

/** Loaded when a preview opens (client only); kept briefly, never refetched in the background. */
export const studioPreviewQueryOptions = (
  db: SupabaseClient,
  kind: 'template' | 'site',
  id: string
) =>
  queryOptions({
    queryKey: studioAdminKeys.preview(kind, id),
    queryFn: () =>
      kind === 'template' ? getStudioTemplatePreview(db, id) : getStudioSitePreview(db, id),
    staleTime: 5 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });
