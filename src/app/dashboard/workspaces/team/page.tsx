import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { teamInfoContent } from '@/config/infoconfig';
import { membersQueryOptions } from '@/features/organizations/api/queries';
import { TeamManager } from '@/features/organizations/components/team-manager';
import { SiteUnavailable } from '@/features/site/components/site-unavailable';
import { requireDashboardSession } from '@/lib/auth/session';
import { getQueryClient } from '@/lib/query-client';
import { createClient } from '@/lib/supabase/server';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { Suspense } from 'react';

export const metadata = { title: 'Équipe & accès' };

export default async function TeamPage() {
  const session = await requireDashboardSession();
  const org = session.activeOrg;
  const queryClient = getQueryClient();
  if (org) void queryClient.prefetchQuery(membersQueryOptions(await createClient(), org.id));

  return (
    <PageContainer
      pageTitle='Équipe & accès'
      pageDescription={org ? `Qui peut gérer ${org.name}` : 'Membres de votre organisation'}
      infoContent={teamInfoContent}
    >
      {org ? (
        <HydrationBoundary state={dehydrate(queryClient)}>
          <Suspense fallback={<Skeleton className='h-64 w-full' />}>
            <TeamManager />
          </Suspense>
        </HydrationBoundary>
      ) : (
        <SiteUnavailable reason='no-website' />
      )}
    </PageContainer>
  );
}
