import 'server-only';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { getQueryClient } from '@/lib/query-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HydrationBoundary, dehydrate, type QueryClient } from '@tanstack/react-query';
import { Suspense } from 'react';
import { loadSitePage } from '../server';
import { SiteUnavailable } from './site-unavailable';

function ListSkeleton() {
  return (
    <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className='h-20 w-full' />
      ))}
    </div>
  );
}

/**
 * Server wrapper for /dashboard/site pages: resolves the active website,
 * checks the feature flag, prefetches with the user's cookie-bound client
 * (RLS applies) and streams the client component under Suspense.
 */
export async function SitePage({
  title,
  description,
  feature,
  prefetch,
  children
}: {
  title: string;
  description: string;
  feature?: string | string[];
  prefetch: (queryClient: QueryClient, db: SupabaseClient, websiteId: string) => void;
  children: React.ReactNode;
}) {
  const page = await loadSitePage(feature);
  if (page.status !== 'ok') {
    return (
      <PageContainer pageTitle={title} pageDescription={description}>
        <SiteUnavailable reason={page.status} />
      </PageContainer>
    );
  }

  const queryClient = getQueryClient();
  prefetch(queryClient, page.db, page.website.id);

  return (
    <PageContainer
      pageTitle={title}
      pageDescription={`${description} — ${page.website.primaryDomain ?? page.website.name}`}
    >
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<ListSkeleton />}>{children}</Suspense>
      </HydrationBoundary>
    </PageContainer>
  );
}
