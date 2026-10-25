import { parseAsInteger, parseAsString, parseAsStringLiteral } from 'nuqs/server';
import { SUBMISSION_VIEWS, type SubmissionFilters, type SubmissionView } from '../api/types';

/**
 * URL state of the forms inbox, shared by the server cache
 * (`src/lib/searchparams.ts`) and the client (`useQueryStates`).
 */
export const submissionParams = {
  view: parseAsStringLiteral(SUBMISSION_VIEWS).withDefault('open'),
  type: parseAsString.withDefault(''),
  q: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1)
};

export const SUBMISSIONS_PER_PAGE = 25;

export function toSubmissionFilters(params: {
  view: SubmissionView;
  type: string;
  q: string;
  page: number;
}): SubmissionFilters {
  return {
    view: params.view,
    formType: /^[a-z][a-z0-9_]{1,39}$/.test(params.type) ? params.type : null,
    search: params.q.trim().slice(0, 100) || null,
    page: Math.max(1, Math.min(params.page, 4000)),
    perPage: SUBMISSIONS_PER_PAGE
  };
}
