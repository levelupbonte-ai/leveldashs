import { parseAsString, parseAsStringLiteral } from 'nuqs/server';
import type { MediaFilters } from '../api/types';

export const MEDIA_KINDS = ['all', 'image', 'video', 'document'] as const;

/**
 * URL state of the media library, shared by the server cache
 * (`src/lib/searchparams.ts`) and the client (`useQueryStates`): both map it
 * with `toMediaFilters`, so they build the same query key.
 */
export const mediaParams = {
  q: parseAsString.withDefault(''),
  kind: parseAsStringLiteral(MEDIA_KINDS).withDefault('all')
};

export function toMediaFilters(params: {
  q: string;
  kind: (typeof MEDIA_KINDS)[number];
}): MediaFilters {
  return {
    kind: params.kind === 'all' ? null : params.kind,
    search: params.q.trim().slice(0, 100) || null
  };
}
