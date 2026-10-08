import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import {
  accessRequestsQueryOptions,
  allWebsitesQueryOptions
} from '@/features/organizations/api/queries';
import { AccessRequests } from '@/features/organizations/components/access-requests';
import { AdminWebsites } from '@/features/organizations/components/admin-websites';
import { NewClientForm } from '@/features/organizations/components/new-client-form';
import {
  aiInsightsQueryOptions,
  projectRequestsQueryOptions
} from '@/features/platform-admin/api/queries';
import { AiInsights } from '@/features/platform-admin/components/ai-insights';
import { ProjectRequests } from '@/features/platform-admin/components/project-requests';
import { requireDashboardSession } from '@/lib/auth/session';
import { getQueryClient } from '@/lib/query-client';
import { createClient } from '@/lib/supabase/server';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

export const metadata = { title: 'LevelUp admin' };

// LevelUp staff only (public.platform_admins). RLS returns every website to
// platform admins; for anyone else this page does not exist.
export default async function AdminPage() {
  const session = await requireDashboardSession();
  if (!session.isPlatformAdmin) notFound();

  const queryClient = getQueryClient();
  const db = await createClient();
  void queryClient.prefetchQuery(allWebsitesQueryOptions(db));
  void queryClient.prefetchQuery(accessRequestsQueryOptions(db));
  void queryClient.prefetchQuery(projectRequestsQueryOptions(db));
  void queryClient.prefetchQuery(aiInsightsQueryOptions(db));

  return (
    <PageContainer pageTitle='Tous les clients' pageDescription='Sites gérés par LevelUp'>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <div className='space-y-6'>
          <Suspense fallback={<Skeleton className='h-32 w-full' />}>
            <AccessRequests />
          </Suspense>
          <Suspense fallback={<Skeleton className='h-64 w-full' />}>
            <ProjectRequests />
          </Suspense>
          <NewClientForm />
          <Suspense fallback={<Skeleton className='h-64 w-full' />}>
            <AdminWebsites />
          </Suspense>
          <Suspense fallback={<Skeleton className='h-96 w-full' />}>
            <AiInsights />
          </Suspense>
        </div>
      </HydrationBoundary>
    </PageContainer>
  );
}
