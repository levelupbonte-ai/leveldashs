import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, isMfaError, type ErrorCode } from '@/lib/errors';
import type { StudioPreview, StudioSiteFilters, StudioSitesPage, StudioTemplateRow } from './types';

// LevelUp staff only. Every function is SECURITY DEFINER, checks the caller is a
// platform admin on an aal2 session and writes hq_audit_log (`studio.viewed` for
// every list and preview). Nothing here edits a site.

type DbError = { message?: string; code?: string } | null;

function studioError(error: DbError, fallback: ErrorCode): AppError {
  if (isMfaError(error)) return new AppError('mfaRequired', { cause: error });
  if (error?.code === 'PT403' || error?.code === '42501') {
    return new AppError('forbidden', { cause: error });
  }
  if (error?.code === 'PT404') return new AppError('notFound', { cause: error });
  if (error?.code === '22023') return new AppError('invalidValues', { cause: error });
  return new AppError(fallback, { cause: error });
}

export async function listStudioTemplates(db: SupabaseClient): Promise<StudioTemplateRow[]> {
  const { data, error } = await db.rpc('admin_studio_templates');
  if (error) throw studioError(error, 'loadFailed');
  return (data ?? []) as StudioTemplateRow[];
}

export async function listStudioSites(
  db: SupabaseClient,
  filters: StudioSiteFilters
): Promise<StudioSitesPage> {
  const { data, error } = await db.rpc('admin_studio_projects', {
    p_search: filters.search,
    p_status: filters.status,
    p_page: filters.page,
    p_per_page: filters.perPage
  });
  if (error) throw studioError(error, 'loadFailed');
  return data as StudioSitesPage;
}

export async function getStudioTemplatePreview(
  db: SupabaseClient,
  id: string
): Promise<StudioPreview> {
  const { data, error } = await db.rpc('admin_studio_template_preview', { p_id: id });
  if (error) throw studioError(error, 'loadFailed');
  const row = data as { id: string; name: string; html: string | null };
  return { id: row.id, title: row.name, html: row.html };
}

export async function getStudioSitePreview(db: SupabaseClient, id: string): Promise<StudioPreview> {
  const { data, error } = await db.rpc('admin_studio_project_preview', { p_id: id });
  if (error) throw studioError(error, 'loadFailed');
  return data as StudioPreview;
}

/** The creator's full e-mail (audited as studio.creator_email_viewed). */
export async function revealStudioCreatorEmail(
  db: SupabaseClient,
  id: string
): Promise<string | null> {
  const { data, error } = await db.rpc('admin_studio_creator_email', { p_id: id });
  if (error) throw studioError(error, 'loadFailed');
  return (data as { email: string | null }).email;
}

export async function setStudioTemplatePublished(
  db: SupabaseClient,
  id: string,
  published: boolean
): Promise<void> {
  const { error } = await db.rpc('admin_studio_set_template_published', {
    p_id: id,
    p_published: published
  });
  if (error) throw studioError(error, 'saveFailed');
}
