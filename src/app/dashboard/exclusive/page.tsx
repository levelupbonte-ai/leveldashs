import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { allWebsitesQueryOptions } from '@/features/organizations/api/queries';
import { AdminWebsites } from '@/features/organizations/components/admin-websites';
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
  void queryClient.prefetchQuery(allWebsitesQueryOptions(await createClient()));

  return (
    <PageContainer pageTitle='Tous les clients' pageDescription='Sites gérés par LevelUp'>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<Skeleton className='h-64 w-full' />}>
          <AdminWebsites />
        </Suspense>
      </HydrationBoundary>
    </PageContainer>
  );
}
