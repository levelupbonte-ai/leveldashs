import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { siteKeys } from '@/features/site/api/queries';
import {
  getActivityLog,
  getAnalyticsSummary,
  getOverviewStats,
  getRecentActivity,
  getSiteCapabilities,
  getVisitorCountries
} from './service';
import type { RangeDays } from './types';

// Under siteKeys.website(id): every site mutation refreshes these too.
export const insightKeys = {
  all: (websiteId: string) => [...siteKeys.website(websiteId), 'insights'] as const,
  capabilities: (websiteId: string) => [...insightKeys.all(websiteId), 'capabilities'] as const,
  overview: (websiteId: string, days: RangeDays) =>
    [...insightKeys.all(websiteId), 'overview', days] as const,
  analytics: (websiteId: string, days: RangeDays) =>
    [...insightKeys.all(websiteId), 'analytics', days] as const,
  activity: (websiteId: string) => [...insightKeys.all(websiteId), 'activity'] as const,
  log: (websiteId: string, page: number) => [...insightKeys.all(websiteId), 'log', page] as const,
  countries: (websiteId: string, days: RangeDays) =>
    [...insightKeys.all(websiteId), 'countries', days] as const
};

export const capabilitiesQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: insightKeys.capabilities(websiteId),
    queryFn: () => getSiteCapabilities(db, websiteId),
    staleTime: 60 * 1000
  });

export const overviewStatsQueryOptions = (db: SupabaseClient, websiteId: string, days: RangeDays) =>
  queryOptions({
    queryKey: insightKeys.overview(websiteId, days),
    queryFn: () => getOverviewStats(db, websiteId, days),
    staleTime: 30 * 1000
  });

export const analyticsQueryOptions = (db: SupabaseClient, websiteId: string, days: RangeDays) =>
  queryOptions({
    queryKey: insightKeys.analytics(websiteId, days),
    queryFn: () => getAnalyticsSummary(db, websiteId, days),
    staleTime: 60 * 1000
  });

export const activityQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: insightKeys.activity(websiteId),
    queryFn: () => getRecentActivity(db, websiteId),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000
  });

export const countriesQueryOptions = (db: SupabaseClient, websiteId: string, days: RangeDays) =>
  queryOptions({
    queryKey: insightKeys.countries(websiteId, days),
    queryFn: () => getVisitorCountries(db, websiteId, days),
    staleTime: 60 * 1000
  });

export const activityLogQueryOptions = (db: SupabaseClient, websiteId: string, page: number) =>
  queryOptions({
    queryKey: insightKeys.log(websiteId, page),
    queryFn: () => getActivityLog(db, websiteId, page),
    staleTime: 30 * 1000
  });
