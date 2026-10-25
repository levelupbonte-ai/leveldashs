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

/** public.contract_templates row (staff only). */
export interface AdminContractTemplate {
  id: string;
  key: 'msa' | 'order_form';
  version: number;
  locale: 'en' | 'fr';
  title: string;
  publishedAt: string | null;
}

/** A contract as LevelUp staff sees it (drafts included). */
export interface AdminContractRow {
  id: string;
  organizationId: string;
  websiteId: string | null;
  templateKey: string;
  templateVersion: number;
  title: string;
  locale: 'en' | 'fr';
  status: 'draft' | 'sent' | 'signed' | 'void' | 'superseded';
  required: boolean;
  createdAt: string;
  sentAt: string | null;
  signedAt: string | null;
  voidReason: string | null;
  signerName: string | null;
}

export interface AdminContractInput {
  organizationId: string;
  websiteId: string | null;
  locale: 'en' | 'fr';
  required: boolean;
  orderForm: {
    projectName?: string;
    packageName?: string;
    scope?: string[];
    buildPrice?: number;
    paymentSchedule?: string;
    monthlyPlan?: string;
    monthlyPrice?: number;
    startDate?: string;
    notes?: string;
  };
}

export interface PublishTemplateInput {
  key: 'msa' | 'order_form';
  locale: 'en' | 'fr';
  version: number | null;
  title: string;
  body: string;
}

// ---------------------------------------------------------------- access review

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

/** public.admin_list_access_requests() row. */
export interface AccessRequest {
  user_id: string;
  business_name: string;
  website: string | null;
  phone: string | null;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at: string | null;
  email: string | null;
  email_confirmed: boolean;
  full_name: string | null;
  organization_id: string | null;
  organization_name: string | null;
  organization_status: string | null;
  /** Non-archived websites of the organization the request was attached to. */
  organization_websites: number;
  website_id: string | null;
  website_name: string | null;
  website_domain: string | null;
}

/** A website staff can connect a request to (admin_access_review_context). */
export interface ReviewSite {
  id: string;
  name: string;
  primary_domain: string | null;
  status: string;
  organization_id: string;
  organization_name: string;
  members: number;
  owners: number;
  applicant_is_member: boolean;
  hosts: string[];
  host_match: boolean;
  email_match: boolean;
}

export interface ReviewContext {
  request: {
    user_id: string;
    business_name: string;
    website: string | null;
    phone: string | null;
    message: string | null;
    status: AccessRequest['status'];
    created_at: string;
    organization_id: string | null;
    website_id: string | null;
    full_name: string | null;
  };
  email: string | null;
  email_confirmed: boolean;
  requested_host: string | null;
  email_domain: string | null;
  current_organization: {
    id: string;
    name: string;
    status: string;
    websites: number;
    members: number;
  } | null;
  websites: ReviewSite[];
  organizations: { id: string; name: string; websites: number; owners: number }[];
}

export type ReviewDecision =
  | { userId: string; mode: 'reject' }
  | {
      userId: string;
      mode: 'connect';
      websiteId: string;
      role: OrgRole;
      confirmWebsiteId?: string;
    }
  | {
      userId: string;
      mode: 'create';
      organizationName: string;
      websiteName?: string;
      websiteDomain?: string;
    };

export interface ReviewOutcome {
  status: 'approved' | 'rejected';
  mode: 'connect' | 'create' | 'reject';
  organizationName: string | null;
  websiteName: string | null;
  archivedOrganizationId: string | null;
  unchanged: boolean;
  emailSent: boolean;
}

// ---------------------------------------------------------------- site access

export type ActivationCodeStatus = 'active' | 'used' | 'revoked' | 'expired';

export interface ActivationCodeRow {
  id: string;
  hint: string;
  role: OrgRole;
  email: string | null;
  status: ActivationCodeStatus;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by_email: string | null;
}

/** public.admin_get_site_access(): owners, pending owner e-mail, codes (never the codes themselves). */
export interface SiteAccess {
  website: {
    id: string;
    name: string;
    primary_domain: string | null;
    status: string;
    organization_id: string;
    organization_name: string;
    organization_status: string;
  };
  owners: { email: string; full_name: string | null }[];
  members: number;
  owner_claim: { email: string; created_at: string } | null;
  codes: ActivationCodeRow[];
}

/** Returned once by admin_create_activation_code. */
export interface NewActivationCode {
  id: string;
  code: string;
  role: OrgRole;
  email: string | null;
  expires_at: string;
  website_id: string;
  website_name: string;
}
