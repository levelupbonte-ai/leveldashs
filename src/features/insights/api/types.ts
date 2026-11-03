import type { PaymentMethod, PaymentProvider } from '@/lib/validation/site-events';

/** Time ranges offered on the overview, analytics and payments pages. */
export const RANGE_DAYS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];

/** Row counts per kind of content / interaction (keys match the collections). */
export interface CapabilityCounts {
  appointments: number;
  waitlist: number;
  submissions: number;
  services: number;
  team: number;
  gallery: number;
  reviews: number;
  faq: number;
  announcements: number;
  templates: number;
  'case-studies': number;
  'page-sections': number;
  content_blocks: number;
  media: number;
  settings: number;
  payments: number;
  traffic_days: number;
  api_keys: number;
  /** LevelUp only: start-a-project requests (feature project_requests). */
  project_requests: number;
  /** LevelUp only: LevelStudio projects (feature studio_insights). */
  studio_projects: number;
}
export type CapabilityKey = keyof CapabilityCounts;

export interface DetectedForm {
  form_type: string;
  total: number;
  new: number;
  last_at: string | null;
}

/** public.site_capabilities: what the website has. */
export interface SiteCapabilities {
  website_id: string;
  features: string[];
  counts: CapabilityCounts;
  forms: DetectedForm[];
  pages: string[];
  settings_keys: string[];
  last_content_update: string | null;
  tag: { last_seen_at: string | null; version: string | null; origin: string | null };
  last_payment_at: string | null;
  last_visit_day: string | null;
}

export interface CurrencyTotals {
  currency: string;
  revenue: number;
  refunded: number;
  paid_count: number;
  refund_count: number;
  previous_revenue: number;
}

/** public.site_payments_summary (amounts in minor units). */
export interface PaymentsSummary {
  days: number;
  from: string;
  currencies: CurrencyTotals[];
  pending_count: number;
  failed_count: number;
  total_count: number;
  test_count: number;
  /** Providers / methods used by the payments of this mode (filters). */
  providers?: { provider: PaymentProvider; count: number }[];
  methods?: { method: PaymentMethod; count: number }[];
  series: { day: string; currency: string; amount: number; count: number }[];
  offers: { offer: string; currency: string; amount: number; count: number }[];
}

export interface DailyTraffic {
  day: string;
  views: number;
  visitors: number;
}

/** public.site_overview_stats. */
export interface OverviewStats {
  days: number;
  from: string;
  to: string;
  submissions: {
    series: { day: string; form_type: string; count: number }[];
    by_type: { form_type: string; count: number; previous: number }[];
    open: number;
    new: number;
  };
  quotes: { open: number; in_range: number; won: number };
  newsletter: { total: number; in_range: number };
  bookings: {
    today: number;
    upcoming: number;
    pending: number;
    in_range: number;
    previous: number;
    no_shows: number;
    completed: number;
    series: { day: string; count: number }[];
  };
  waitlist: { waiting: number; served_today: number; in_range: number };
  reviews: { count: number; average: number | null; new: number };
  traffic: { views: number; visitors: number; previous_visitors: number; series: DailyTraffic[] };
  payments: PaymentsSummary;
  /** null unless the website receives project requests and the caller may read them. */
  project_requests: ProjectRequestStats | null;
  /** null unless the website has LevelStudio insights and the caller may read them. */
  studio: StudioSummary | null;
}

export interface ProjectRequestStats {
  total: number;
  new: number;
  in_range: number;
  qualified: number;
  review: number;
  rejected: number;
  average_score: number | null;
  won: number;
  handoffs_claimed: number;
}

/** Aggregate LevelStudio usage (no person). */
export interface StudioSummary {
  projects_total: number;
  projects_in_range: number;
  creators_total: number;
  creators_in_range: number;
  signed_in_creators: number;
  shared: number;
  generations_in_range: number;
  series: { day: string; count: number }[];
  frameworks: { framework: string; count: number }[];
  handoffs: number;
  handoffs_claimed: number;
}

/** public.site_analytics_summary. */
export interface AnalyticsSummary {
  days: number;
  from: string;
  to: string;
  has_data: boolean;
  last_day: string | null;
  totals: { views: number; visitors: number; previous_views: number; previous_visitors: number };
  series: DailyTraffic[];
  pages: { path: string; views: number; visitors: number }[];
  referrers: { host: string; views: number }[];
  direct_views: number;
  languages: { lang: string; views: number }[];
}

export type ActivityKind =
  | 'submission'
  | 'appointment'
  | 'waitlist'
  | 'payment'
  | 'review'
  | 'project_request';

/** public.site_recent_activity. */
export interface ActivityItem {
  kind: ActivityKind;
  id: string;
  at: string;
  label: string;
  title?: string | null;
  status?: string;
  amount?: number;
  currency?: string;
  rating?: number | null;
  date?: string;
  time?: string;
}

/** One row of public.site_activity_log: who in the team changed what. */
export interface ActivityLogEntry {
  id: number;
  created_at: string;
  /** e.g. content.updated, email.campaign_started, portal.message_sent */
  action: string;
  /** Table area of a content change (services, media, website_settings, …). */
  area: string | null;
  /** Readable name of the item (service name, setting key, …). */
  label: string | null;
  /** Team member e-mail, 'LevelUp' for LevelUp staff, null for the system. */
  actor: string | null;
}

export interface ActivityLogPage {
  total: number;
  rows: ActivityLogEntry[];
}
