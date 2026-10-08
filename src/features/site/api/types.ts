export type ContentRow = Record<string, unknown> & {
  id: string;
  website_id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
};

export interface Appointment {
  id: string;
  ticket_code: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  service_name: string | null;
  price_label: string | null;
  team_member_name: string | null;
  appointment_date: string;
  appointment_time: string;
  notes: string | null;
  staff_notes: string | null;
  status: AppointmentStatus;
  created_at: string;
}
export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export interface WaitlistEntry {
  id: string;
  ticket_code: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  service_name: string | null;
  team_member_name: string | null;
  position: number;
  est_minutes: number;
  status: WaitlistStatus;
  joined_at: string;
}
export type WaitlistStatus = 'waiting' | 'called' | 'in_chair' | 'served' | 'cancelled';

export interface FormSubmission {
  id: string;
  form_type: string;
  ticket_code: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  message: string | null;
  data: Record<string, unknown>;
  status: SubmissionStatus;
  staff_notes: string | null;
  source: string | null;
  created_at: string;
}
export type SubmissionStatus =
  | 'new'
  | 'contacted'
  | 'in_progress'
  | 'quoted'
  | 'won'
  | 'lost'
  | 'closed'
  | 'spam';

export interface MediaItem {
  id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  alt_text: string | null;
  created_at: string;
  url: string;
}

export interface WebsiteSetting {
  key: string;
  value: unknown;
  is_public: boolean;
  updated_at: string;
}

export interface ContentBlock {
  id: string;
  page: string;
  block_key: string;
  data: Record<string, unknown>;
  status: string;
  sort_order: number;
  updated_at: string;
}

export interface SiteOverview {
  pendingAppointments: number;
  upcomingAppointments: number;
  waiting: number;
  newRequests: number;
  media: number;
}

export interface WebsiteIntegration {
  id: string;
  name: string;
  status: string;
  primary_domain: string | null;
  allowed_origins: string[];
  show_powered_by: boolean;
  tag_last_seen_at: string | null;
  tag_last_seen_origin: string | null;
  tag_version: string | null;
}

export interface SeoSettings {
  enabled?: boolean;
  title?: string;
  description?: string;
  keywords?: string[];
  image?: string;
  business_name?: string;
  business_type?: string;
  google_site_verification?: string;
  robots?: string;
  pages?: Record<string, { title?: string; description?: string; image?: string; robots?: string }>;
}
