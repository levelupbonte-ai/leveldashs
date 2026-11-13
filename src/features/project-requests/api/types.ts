export const PROJECT_REQUEST_STATUSES = [
  'new',
  'contacted',
  'demo',
  'won',
  'lost',
  'rejected'
] as const;
export type ProjectRequestStatus = (typeof PROJECT_REQUEST_STATUSES)[number];
export const AI_VERDICTS = ['qualified', 'review', 'rejected'] as const;
export type AiVerdict = (typeof AI_VERDICTS)[number];

/** A "Start a project" request (LevelUp showcase), contact masked for viewers. */
export interface ProjectRequest {
  id: string;
  created_at: string;
  locale: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  business_name: string | null;
  has_business: boolean | null;
  business_stage: string | null;
  sector: string | null;
  business_age: string | null;
  website: string | null;
  social_links: string[];
  budget: string | null;
  timeline: string | null;
  project_type: string | null;
  brief: Record<string, unknown> | null;
  ai_score: number | null;
  ai_verdict: AiVerdict | null;
  ai_summary: string | null;
  ai_reasons: unknown;
  ai_red_flags: unknown;
  status: ProjectRequestStatus;
  notes: string | null;
  reviewed_at: string | null;
  handoff: { created_at: string; claimed_at: string | null; open_count: number } | null;
  /** Human demo (19 USD): null when the visitor did not choose it. */
  demo: ProjectDemo | null;
  estimate: { min_days: number; max_days: number | null; note: string | null } | null;
  masked: boolean;
}

export const DEMO_STEPS = [
  'paid',
  'analysis',
  'design',
  'build',
  'final_check',
  'ready',
  'cancelled'
] as const;
export type DemoStep = (typeof DEMO_STEPS)[number];
export type DemoStatus = DemoStep | 'awaiting_payment';

export interface ProjectDemo {
  status: DemoStatus;
  paid_at: string | null;
  amount: number | null;
  currency: string | null;
  ready_by: string | null;
  url: string | null;
  code: string | null;
  events: { status: DemoStatus; message: string | null; at: string }[];
}

export interface ProjectRequestFilters {
  status: ProjectRequestStatus | null;
  verdict: AiVerdict | null;
  search: string | null;
  page: number;
  perPage: number;
}

export interface ProjectRequestPage {
  rows: ProjectRequest[];
  total: number;
  pii: boolean;
  can_edit: boolean;
}
