import { parseAsInteger, parseAsString, parseAsStringLiteral } from 'nuqs/server';
import { CONTACT_STATUSES, type ContactFilters } from '../api/types';

/**
 * URL state of the Email campaigns page, shared by the server cache
 * (`src/lib/searchparams.ts`) and the client (`useQueryStates`): both map the
 * contact filters with `toContactFilters`, so they build the same query key.
 */
export const EMAIL_TABS = ['campaigns', 'editor', 'contacts'] as const;
export type EmailTab = (typeof EMAIL_TABS)[number];

export const emailParams = {
  tab: parseAsStringLiteral(EMAIL_TABS).withDefault('campaigns'),
  campaign: parseAsString.withDefault(''),
  q: parseAsString.withDefault(''),
  status: parseAsStringLiteral(CONTACT_STATUSES),
  page: parseAsInteger.withDefault(1)
};

export const CONTACTS_PER_PAGE = 25;

export function toContactFilters(params: {
  q: string;
  status: ContactFilters['status'];
  page: number;
}): ContactFilters {
  return {
    page: Math.max(1, Math.min(params.page, 5000)),
    perPage: CONTACTS_PER_PAGE,
    search: params.q.trim().slice(0, 100) || null,
    status: params.status ?? null
  };
}
