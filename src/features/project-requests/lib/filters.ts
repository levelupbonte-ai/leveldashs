import { parseAsInteger, parseAsString, parseAsStringLiteral } from 'nuqs/server';
import {
  AI_VERDICTS,
  PROJECT_REQUEST_STATUSES,
  type AiVerdict,
  type ProjectRequestFilters,
  type ProjectRequestStatus
} from '../api/types';

/** URL state of the project requests page (server cache + client useQueryStates). */
export const projectRequestParams = {
  status: parseAsStringLiteral(PROJECT_REQUEST_STATUSES),
  verdict: parseAsStringLiteral(AI_VERDICTS),
  q: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1)
};

export function toProjectRequestFilters(p: {
  status: ProjectRequestStatus | null;
  verdict: AiVerdict | null;
  q: string;
  page: number;
}): ProjectRequestFilters {
  return {
    status: p.status,
    verdict: p.verdict,
    search: p.q.trim().slice(0, 100) || null,
    page: Math.max(1, Math.min(p.page, 4000)),
    perPage: 20
  };
}
