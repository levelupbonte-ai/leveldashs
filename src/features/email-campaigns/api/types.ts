import type { CampaignTemplate } from '../lib/render';

export type { CampaignTemplate };

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'failed'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CONTACT_STATUSES = ['subscribed', 'unsubscribed', 'bounced', 'complained'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export type FailureReason =
  | 'quota'
  | 'daily_cap'
  | 'paused'
  | 'sender_missing'
  | 'no_recipients'
  | 'content_missing'
  | 'provider';

/** What the e-mails show (private.email_brand). */
export interface EmailBrand {
  business_name: string;
  site_name: string;
  site_domain: string | null;
  logo_url: string | null;
  brand_color: string | null;
  reply_to: string | null;
  postal_address: string | null;
}

export interface SenderProfile {
  from_name: string | null;
  reply_to: string | null;
  postal_address: string;
  brand_color: string | null;
  updated_at: string;
}

/** public.email_overview */
export interface EmailOverview {
  can_edit: boolean;
  can_send: boolean;
  brand: EmailBrand;
  sender: SenderProfile | null;
  /** What is still needed before the first send. */
  missing: ('postal_address' | 'reply_to')[];
  contacts: Record<ContactStatus | 'total', number>;
  /** limit null = unlimited */
  quota: { limit: number | null; used: number; plan: string };
  daily: { cap: number; used: number };
  paused: { at: string; reason: 'bounces' | 'complaints' | 'staff' } | null;
  /** Delivery events arrive (the provider webhook is set up). */
  delivery_tracking: boolean;
}

export interface CampaignStats {
  recipients: number;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
  delivered: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
}

export interface Campaign {
  id: string;
  website_id: string;
  template: CampaignTemplate;
  locale: 'en' | 'fr';
  subject: string;
  preview_text: string;
  heading: string;
  body: string;
  button_label: string | null;
  button_url: string | null;
  image_media_id: string | null;
  image_path: string | null;
  status: CampaignStatus;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  failure_reason: FailureReason | null;
  recipient_count: number;
  created_at: string;
  updated_at: string;
  stats: CampaignStats;
}

export interface CampaignValues {
  template: CampaignTemplate;
  locale: 'en' | 'fr';
  subject: string;
  preview_text: string;
  heading: string;
  body: string;
  button_label: string | null;
  button_url: string | null;
  image_media_id: string | null;
}

export interface Contact {
  id: string;
  /** Masked (j***@e***.com) for viewers. */
  email: string;
  name: string | null;
  source: 'newsletter' | 'import';
  status: ContactStatus;
  consent_at: string;
  /** Null for viewers. */
  consent_source: string | null;
  status_changed_at: string;
  created_at: string;
}

export interface ContactFilters {
  page: number;
  perPage: number;
  search: string | null;
  status: ContactStatus | null;
}

export interface ContactPage {
  rows: Contact[];
  total: number;
  pii: boolean;
}

export interface ExportedContact {
  email: string;
  name: string | null;
  status: ContactStatus;
  source: string;
  consent_at: string;
  consent_source: string;
  status_changed_at: string;
  created_at: string;
}

export interface ImportResult {
  import_id: string;
  received: number;
  added: number;
  existing: number;
  invalid: number;
}

export interface SenderInput {
  from_name: string;
  reply_to: string;
  postal_address: string;
  brand_color: string;
}

/** Answer of the send / process routes. */
export interface SendProgress {
  status: 'sending' | 'done' | 'paused';
  recipients?: number;
  sent: number;
}

/** Footer wording in both languages (passed by the page; e-mail messages are not shipped to the browser). */
export type FooterLabelSet = Record<
  'en' | 'fr',
  { reason: string; unsubscribe: string; addressMissing: string }
>;
