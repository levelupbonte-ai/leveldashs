import type { FormSubmission, SubmissionStatus } from '@/features/site/api/types';

export type { FormSubmission, SubmissionStatus };

/** Inbox views: groups of statuses. */
export const SUBMISSION_VIEWS = ['open', 'handled', 'archived', 'spam', 'all'] as const;
export type SubmissionView = (typeof SUBMISSION_VIEWS)[number];

export const VIEW_STATUSES: Record<SubmissionView, SubmissionStatus[]> = {
  open: ['new', 'contacted', 'in_progress', 'quoted'],
  handled: ['won', 'lost', 'closed'],
  archived: ['archived'],
  spam: ['spam'],
  all: []
};

export interface SubmissionFilters {
  view: SubmissionView;
  /** null = every form type. */
  formType: string | null;
  search: string | null;
  page: number;
  perPage: number;
}

export interface SubmissionPage {
  rows: FormSubmission[];
  total: number;
}
