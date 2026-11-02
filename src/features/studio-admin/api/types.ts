// LevelStudio in the LevelUp staff area (platform admins on aal2 only). Shapes
// returned by the admin_studio_* database functions; every call is audited.

export const STUDIO_TEMPLATE_KINDS = ['starter', 'style', 'import'] as const;
export type StudioTemplateKind = (typeof STUDIO_TEMPLATE_KINDS)[number];

export interface StudioTemplateRow {
  id: string;
  name: string;
  kind: StudioTemplateKind;
  tagline: string | null;
  service: string;
  accent: string | null;
  palette: string[];
  is_published: boolean;
  has_html: boolean;
  /** Imports only: the owner's e-mail, masked by the database. */
  owner_email_masked: string | null;
  /** An import made by a visitor without an account. */
  owner_is_visitor: boolean;
  /** Sites created from this template. */
  uses: number;
  created_at: string;
  updated_at: string;
}

export const STUDIO_SITE_STATUSES = ['draft', 'shared'] as const;
export type StudioSiteStatus = (typeof STUDIO_SITE_STATUSES)[number];

export interface StudioSiteRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  versions: number;
  creator_email_masked: string | null;
  creator_has_account: boolean;
  status: StudioSiteStatus;
  /** `/p/<token>` on LevelStudio while the share link is live. */
  share_path: string | null;
  share_expires_at: string | null;
  generating: boolean;
  archived: boolean;
  has_html: boolean;
  template_name: string | null;
}

export interface StudioSitesPage {
  total: number;
  page: number;
  per_page: number;
  rows: StudioSiteRow[];
  counts: { all: number; shared: number };
}

export interface StudioSiteFilters {
  page: number;
  perPage: number;
  search: string | null;
  status: StudioSiteStatus | null;
}

export interface StudioPreview {
  id: string;
  title: string;
  html: string | null;
}
