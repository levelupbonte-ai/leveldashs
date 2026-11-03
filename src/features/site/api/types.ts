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
  | 'archived'
  | 'spam';

export type MediaKind = 'image' | 'video' | 'document';

export interface MediaItem {
  id: string;
  /** 'media' (Supabase Storage, older files) or 'r2' (Cloudflare R2). */
  bucket: string;
  storage_path: string;
  thumb_path: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  created_at: string;
  created_by: string | null;
  /** Public URL of the file. */
  url: string;
  /** Small WebP for the library grid (falls back to the file itself). */
  thumbUrl: string;
}

/** Position after the last row of a page (newest first). */
export interface MediaCursor {
  created_at: string;
  id: string;
}

export interface MediaPage {
  rows: MediaItem[];
  next: MediaCursor | null;
}

export interface MediaFilters {
  kind: MediaKind | null;
  search: string | null;
}

/** media_library_stats: totals of one website (bytes include thumbnails). */
export interface MediaStats {
  files: number;
  bytes: number;
  images: number;
  videos: number;
  documents: number;
  /** Storage used by the whole organization (every site). */
  org_bytes?: number | null;
  /** Plan storage limit in bytes; null = unlimited. */
  limit_bytes?: number | null;
  /** Kinds this client may upload (set by LevelUp): 'image' | 'video' | 'document'. */
  allowed_kinds?: string[];
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
