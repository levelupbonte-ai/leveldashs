import { parseAsInteger, parseAsString, parseAsStringLiteral } from 'nuqs/server';
import { STUDIO_SITE_STATUSES, type StudioSiteFilters } from '../api/types';

export const STUDIO_TABS = ['templates', 'sites'] as const;
export type StudioTab = (typeof STUDIO_TABS)[number];

/**
 * URL state of the LevelStudio staff page, shared by the server cache
 * (`src/lib/searchparams.ts`) and the client (`useQueryStates`): both map it with
 * `toStudioSiteFilters`, so they build the same query key.
 */
export const studioParams = {
  tab: parseAsStringLiteral(STUDIO_TABS).withDefault('templates'),
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(20),
  q: parseAsString.withDefault(''),
  status: parseAsStringLiteral(STUDIO_SITE_STATUSES)
};

export interface StudioParams {
  page: number;
  perPage: number;
  q: string;
  status: StudioSiteFilters['status'];
}

export function toStudioSiteFilters(params: StudioParams): StudioSiteFilters {
  return {
    page: Math.max(1, Math.min(params.page, 5000)),
    perPage: [10, 20, 50].includes(params.perPage) ? params.perPage : 20,
    search: params.q.trim().slice(0, 100) || null,
    status: params.status ?? null
  };
}
