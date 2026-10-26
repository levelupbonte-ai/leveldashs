import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import { rpc } from '@/lib/supabase/rpc-error';
import { VIEW_STATUSES, type SubmissionFilters, type SubmissionPage } from './types';

export const EXPORT_LIMIT = 1000;

// Row Level Security decides what the inbox contains (viewer and above read,
// editor and above change status / notes: see updateSubmission in site).

export function listSubmissionPage(
  db: SupabaseClient,
  websiteId: string,
  filters: SubmissionFilters
) {
  const statuses = VIEW_STATUSES[filters.view];
  return rpc<SubmissionPage>(
    db.rpc('site_submissions_list', {
      p_website_id: websiteId,
      p_form_type: filters.formType,
      p_status: statuses.length ? statuses : null,
      p_search: filters.search,
      p_limit: filters.perPage,
      p_offset: (filters.page - 1) * filters.perPage
    })
  );
}

/** Every submission matching the filters (CSV export), up to EXPORT_LIMIT. */
export async function exportSubmissions(
  db: SupabaseClient,
  websiteId: string,
  filters: SubmissionFilters
) {
  const page = await listSubmissionPage(db, websiteId, {
    ...filters,
    page: 1,
    perPage: EXPORT_LIMIT
  });
  if (!page) throw new AppError('generic');
  return page.rows;
}
