export const PORTAL_ITEM_KINDS = ['update', 'trip', 'document', 'checklist'] as const;
export type PortalItemKind = (typeof PORTAL_ITEM_KINDS)[number];
export const PORTAL_AUDIENCES = ['all', 'offer', 'customer'] as const;
export type PortalAudience = (typeof PORTAL_AUDIENCES)[number];

export interface PortalPayment {
  id: string;
  offer_id: string | null;
  offer_name: string | null;
  status: 'paid' | 'refunded' | 'pending';
  amount: number;
  currency: string;
  paid_at: string | null;
  occurred_at: string;
}

/** A member's monthly plan, as Stripe last reported it. */
export interface PortalSubscription {
  plan_name: string;
  level: number;
  amount: number;
  currency: string;
  status: 'active' | 'past_due' | 'canceled' | 'incomplete';
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
}

/** Monthly membership: paid month by month by the member, nothing automatic. */
export interface PortalMembership {
  monthly: boolean;
  until: string | null;
  active: boolean;
  reminders: boolean;
  period_days: number;
  offer_id: string | null;
}

/** The member's monthly plan now (or the last one bought). */
export interface PortalPlanPeriod {
  plan_name: string | null;
  level: number;
  starts_at: string;
  ends_at: string;
  active: boolean;
}

/** A customer of the website's client portal (paid or invited). */
export interface PortalCustomer {
  id: string;
  email: string;
  name: string | null;
  source: 'payment' | 'invite';
  status: 'active' | 'revoked';
  locale: 'en' | 'fr';
  /** End of the free offer (null: none). */
  trial_ends_at: string | null;
  /** What the member can read now: 0 nothing beyond free items, 1-3 a plan level. */
  level: number;
  subscription: PortalSubscription | null;
  membership: PortalMembership | null;
  plan: PortalPlanPeriod | null;
  offer_id: string | null;
  offers: string[];
  payments: PortalPayment[];
  unread: number;
  created_at: string;
  last_sign_in_at: string | null;
  last_message_at: string | null;
}

export interface PortalTripStep {
  date: string | null;
  title: string;
  detail: string | null;
}

export interface PortalTrip {
  start_date: string | null;
  end_date: string | null;
  meeting_point: string | null;
  meeting_time: string | null;
  steps: PortalTripStep[];
}

export interface PortalItem {
  id: string;
  kind: PortalItemKind;
  audience: PortalAudience;
  customer_id: string | null;
  offer_id: string | null;
  title: string;
  body: string | null;
  trip: PortalTrip | null;
  checklist: string[] | null;
  document_name: string | null;
  document_path: string | null;
  document_size: number | null;
  status: 'published' | 'archived';
  published_at: string;
  reads: number;
  /** 0: every member; 1-3: members whose plan (or free offer) reaches this level. */
  min_level: number;
}

export interface PortalOverview {
  customers: PortalCustomer[];
  offers: { id: string; name: string | null }[];
  items: PortalItem[];
  outbox: { pending: number; failed: number; sent: number };
  notify_url: string | null;
}

export interface PortalMessage {
  id: string;
  sender: 'customer' | 'owner';
  body: string;
  created_at: string;
  read_at: string | null;
  /** 'assistant': the member sent it with "Ask …" from the AI assistant. */
  via: 'assistant' | null;
  /** Prepared by the assistant for the team only (never shown to the member). */
  brief: { summary?: string; draft?: string; answer?: string } | null;
  /** Owner reply to an assistant question: shown as validated to the member. */
  reply_to: string | null;
  answered: boolean;
}

export interface PortalKnowledgeNote {
  id: string;
  title: string;
  body: string;
  active: boolean;
  updated_at: string;
}

/** AI assistant of the member space: switch, daily limit, usage, notes. */
export interface PortalAssistant {
  enabled: boolean;
  daily: number;
  /** Images per member per day: [base, plan 1, plan 2, plan 3]. */
  images: number[];
  questions_today: number;
  questions_month: number;
  handoffs_open: number;
  notes: PortalKnowledgeNote[];
}

/** Answers the member gave on the website before paying (free-form JSON). */
export interface PortalProfile {
  profile: Record<string, unknown> | null;
  updated_at: string | null;
  /** What the member wrote about their project. */
  note: string | null;
}

/** What the publish form sends (validated again by portal_admin_publish). */
export interface PortalItemInput {
  kind: PortalItemKind;
  audience: PortalAudience;
  customer_id?: string;
  offer_id?: string;
  title: string;
  body?: string;
  trip?: {
    start_date: string | null;
    end_date: string | null;
    meeting_point: string | null;
    meeting_time: string | null;
    steps: { date: string | null; title: string; detail: string | null }[];
  };
  checklist?: string[];
  document_path?: string;
  document_name?: string;
  min_level?: number;
}

export const PORTAL_PLAN_LEVELS = [1, 2, 3] as const;

/** One of the three monthly plans the owner sets (portal_admin_settings). */
export interface PortalPlan {
  id: string;
  level: number;
  name: string;
  description: string | null;
  features: string[];
  /** Smallest currency unit (cents). */
  amount: number;
  currency: string;
  active: boolean;
  subscribers: number;
}

export interface PortalSettings {
  trial_days: number;
  trial_level: number;
  contact: { phone?: string; whatsapp?: string; note?: string };
  /** Only admins and owners change the offer, plans and contact numbers. */
  can_admin: boolean;
  membership_monthly: boolean;
  period_days: number;
  plans: PortalPlan[];
}

export interface PortalPlanInput {
  level: number;
  name: string;
  description: string;
  features: string[];
  amount: number;
  currency: string;
  active: boolean;
}

export const PORTAL_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
] as const;
export const PORTAL_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
