// LevelUp staff insights: AI catalog/usage and project requests from the
// showcase site. Every table and view here is readable by platform admins only (RLS).

export type AiTier = 'free' | 'paid';

/** public.ai_model_ranking: one row per model (catalog and/or called). */
export interface AiModelRank {
  model_id: string;
  provider: string;
  model: string;
  label: string;
  tier: AiTier | null;
  is_active: boolean | null;
  calls_24h: number;
  calls_7d: number;
  calls_30d: number;
  calls_total: number;
  share_30d: number | null;
  last_used_at: string | null;
}

/** public.ai_usage_stats: calls per app/task/provider/model. */
export interface AiUsageStat {
  app: string;
  task: string;
  provider: string;
  model: string;
  model_id: string;
  calls_24h: number;
  calls_7d: number;
  calls_30d: number;
  calls_total: number;
  last_used_at: string | null;
}

/** One model in a route, in fallback order. */
export interface AiRouteStep {
  position: number;
  modelId: string;
  label: string;
  tier: AiTier;
  calls30d: number;
}

/** app + task: where it is used and which models answer, in order. */
export interface AiRoute {
  app: string;
  task: string;
  description: string;
  steps: AiRouteStep[];
  calls30d: number;
}

export interface AiInsights {
  ranking: AiModelRank[];
  routes: AiRoute[];
  /** Calls logged for an app/task that has no route in the catalog. */
  unrouted: AiUsageStat[];
  totals: { calls24h: number; calls7d: number; calls30d: number; callsTotal: number };
}

export type ProjectVerdict = 'qualified' | 'review' | 'rejected';
export type ProjectStatus = 'new' | 'contacted' | 'demo' | 'won' | 'lost' | 'rejected';

/** public.project_requests (levelup-ecosystem.com "Start a project"). */
export interface ProjectRequest {
  id: string;
  created_at: string;
  locale: string | null;
  name: string;
  email: string;
  phone: string | null;
  business_name: string | null;
  has_business: boolean | null;
  business_stage: string | null;
  sector: string | null;
  business_age: string | null;
  website: string | null;
  social_links: string[];
  registration_number: string | null;
  proof_links: string[];
  budget: string | null;
  timeline: string | null;
  project_type: string | null;
  brief: Record<string, unknown>;
  ai_score: number | null;
  ai_verdict: ProjectVerdict | null;
  ai_summary: string | null;
  ai_reasons: string[];
  ai_red_flags: string[];
  ai_model: string | null;
  status: ProjectStatus;
  notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface ProjectRequestUpdate {
  id: string;
  status: ProjectStatus;
  notes: string;
}

export interface AdminWebsiteRow {
  id: string;
  name: string;
  primaryDomain: string | null;
  status: string;
  organizationId: string;
  organizationName: string;
  features: string[];
}
