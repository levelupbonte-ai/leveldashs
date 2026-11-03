import type { SupabaseClient } from '@supabase/supabase-js';
import { rpc } from '@/lib/supabase/rpc-error';
import type {
  ActivityItem,
  AnalyticsSummary,
  OverviewStats,
  RangeDays,
  SiteCapabilities
} from './types';

// Every call runs as the signed-in user: the functions are SECURITY INVOKER,
// so Row Level Security of each table decides what the numbers include.

export function getSiteCapabilities(db: SupabaseClient, websiteId: string) {
  return rpc<SiteCapabilities | null>(db.rpc('site_capabilities', { p_website_id: websiteId }));
}

export function getOverviewStats(db: SupabaseClient, websiteId: string, days: RangeDays) {
  return rpc<OverviewStats>(
    db.rpc('site_overview_stats', { p_website_id: websiteId, p_days: days })
  );
}

export function getAnalyticsSummary(db: SupabaseClient, websiteId: string, days: RangeDays) {
  return rpc<AnalyticsSummary>(
    db.rpc('site_analytics_summary', { p_website_id: websiteId, p_days: days })
  );
}

export async function getRecentActivity(db: SupabaseClient, websiteId: string) {
  const rows = await rpc<ActivityItem[] | null>(
    db.rpc('site_recent_activity', { p_website_id: websiteId, p_limit: 20 })
  );
  return rows ?? [];
}

/** Visitors per country (two-letter codes), most first. */
export async function getVisitorCountries(db: SupabaseClient, websiteId: string, days: RangeDays) {
  const rows = await rpc<{ country: string; views: number; visitors: number }[] | null>(
    db.rpc('site_analytics_countries', { p_website_id: websiteId, p_days: days })
  );
  return rows ?? [];
}
