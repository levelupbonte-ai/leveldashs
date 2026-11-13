import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, type ErrorCode } from '@/lib/errors';
import { rpc } from '@/lib/supabase/rpc-error';
import { sanitizeNotes } from '@/features/site/api/service';
import {
  PROJECT_REQUEST_STATUSES,
  type ProjectRequestFilters,
  type DemoStep,
  type ProjectRequestPage,
  type ProjectRequestStatus
} from './types';

// project_requests is not a tenant table: members of the organization that
// owns the website (feature project_requests) read it through
// site_project_requests_list, which checks membership + MFA and masks the
// contact for viewers. Owners / admins change status and notes (audited).

export function listProjectRequests(
  db: SupabaseClient,
  websiteId: string,
  filters: ProjectRequestFilters
) {
  return rpc<ProjectRequestPage>(
    db.rpc('site_project_requests_list', {
      p_website_id: websiteId,
      p_status: filters.status ? [filters.status] : null,
      p_verdict: filters.verdict,
      p_search: filters.search,
      p_limit: filters.perPage,
      p_offset: (filters.page - 1) * filters.perPage
    })
  );
}

export async function updateProjectRequest(
  db: SupabaseClient,
  websiteId: string,
  id: string,
  patch: { status?: ProjectRequestStatus; notes?: string }
) {
  if (patch.status && !PROJECT_REQUEST_STATUSES.includes(patch.status)) {
    throw new AppError('invalidValues');
  }
  let notes: string | null | undefined;
  if (patch.notes !== undefined) {
    notes = sanitizeNotes(patch.notes);
    if (notes === undefined) throw new AppError('invalidValues');
  }
  await rpc<null>(
    db.rpc('site_update_project_request', {
      p_website_id: websiteId,
      p_id: id,
      p_status: patch.status ?? null,
      p_notes: patch.notes === undefined ? null : (notes ?? '')
    })
  );
}

/**
 * Owners / admins move a paid human demo to its next step; the route e-mails the
 * client (tracking link) when `notify` is set. Returns whether the e-mail left.
 */
export async function updateProjectDemo(input: {
  websiteId: string;
  id: string;
  status: DemoStep;
  message?: string;
  demoUrl?: string;
  readyBy?: string;
  notify: boolean;
}): Promise<{ emailed: boolean }> {
  const res = await fetch('/api/project-requests/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }).catch((cause) => {
    throw new AppError('network', { cause });
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    emailed?: boolean;
    error?: string;
  };
  if (!res.ok || !json.ok) {
    const known: ErrorCode[] = [
      'demoNotPaid',
      'demoUrlRequired',
      'invalidValues',
      'forbidden',
      'notFound',
      'mfaRequired'
    ];
    throw new AppError(
      known.includes(json.error as ErrorCode) ? (json.error as ErrorCode) : 'saveFailed'
    );
  }
  return { emailed: json.emailed === true };
}
