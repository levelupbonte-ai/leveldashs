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

/** A customer of the website's client portal (paid or invited). */
export interface PortalCustomer {
  id: string;
  email: string;
  name: string | null;
  source: 'payment' | 'invite';
  status: 'active' | 'revoked';
  locale: 'en' | 'fr';
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
}

export const PORTAL_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
] as const;
export const PORTAL_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
