import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { siteKeys } from '@/features/site/api/queries';
import {
  getPortalAssistant,
  getPortalOverview,
  getPortalProfile,
  getPortalQuestionnaires,
  getPortalSettings,
  getPortalThread
} from './service';

export const portalKeys = {
  all: (websiteId: string) => [...siteKeys.website(websiteId), 'client-portal'] as const,
  list: (websiteId: string) => [...portalKeys.all(websiteId), 'overview'] as const,
  settings: (websiteId: string) => [...portalKeys.all(websiteId), 'settings'] as const,
  detail: (websiteId: string, customerId: string) =>
    [...portalKeys.all(websiteId), 'thread', customerId] as const,
  profile: (websiteId: string, customerId: string) =>
    [...portalKeys.all(websiteId), 'profile', customerId] as const,
  assistant: (websiteId: string) => [...portalKeys.all(websiteId), 'assistant'] as const,
  questionnaires: (websiteId: string) => [...portalKeys.all(websiteId), 'questionnaires'] as const
};

export const portalOverviewQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: portalKeys.list(websiteId),
    queryFn: () => getPortalOverview(db, websiteId),
    staleTime: 30 * 1000
  });

export const portalThreadQueryOptions = (
  db: SupabaseClient,
  websiteId: string,
  customerId: string
) =>
  queryOptions({
    queryKey: portalKeys.detail(websiteId, customerId),
    queryFn: () => getPortalThread(db, customerId),
    staleTime: 10 * 1000
  });

export const portalSettingsQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: portalKeys.settings(websiteId),
    queryFn: () => getPortalSettings(db, websiteId),
    staleTime: 60 * 1000
  });

export const portalProfileQueryOptions = (
  db: SupabaseClient,
  websiteId: string,
  customerId: string
) =>
  queryOptions({
    queryKey: portalKeys.profile(websiteId, customerId),
    queryFn: () => getPortalProfile(db, customerId),
    staleTime: 5 * 60 * 1000
  });

export const portalAssistantQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: portalKeys.assistant(websiteId),
    queryFn: () => getPortalAssistant(db, websiteId),
    staleTime: 30 * 1000
  });

export const portalQuestionnairesQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: portalKeys.questionnaires(websiteId),
    queryFn: () => getPortalQuestionnaires(db, websiteId),
    staleTime: 60 * 1000
  });
