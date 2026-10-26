import { createSearchParamsCache } from 'nuqs/server';
import { rangeParser } from '@/features/insights/lib/range';
import { paymentParams } from '@/features/payments/lib/filters';
import { submissionParams } from '@/features/submissions/lib/filters';
import { projectRequestParams } from '@/features/project-requests/lib/filters';
import { mediaParams } from '@/features/site/lib/media-filters';

// Server-side readers of the URL state of each page. The parsers are the same
// ones the client components use with useQueryStates, so the server prefetch
// and the client build the same query key.

export const rangeSearchParamsCache = createSearchParamsCache({ range: rangeParser });
export const paymentSearchParamsCache = createSearchParamsCache(paymentParams);
export const submissionSearchParamsCache = createSearchParamsCache(submissionParams);
export const projectRequestSearchParamsCache = createSearchParamsCache(projectRequestParams);
export const mediaSearchParamsCache = createSearchParamsCache(mediaParams);
