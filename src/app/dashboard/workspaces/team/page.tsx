import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { getTeamInfoContent } from '@/config/infoconfig';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { membersQueryOptions } from '@/features/organizations/api/queries';
import { TeamManager } from '@/features/organizations/components/team-manager';
import { SiteUnavailable } from '@/features/site/components/site-unavailable';
import { requireDashboardSession } from '@/lib/auth/session';
import { getQueryClient } from '@/lib/query-client';
import { createClient } from '@/lib/supabase/server';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { Suspense } from 'react';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('team');
  return { title: t('title') };
}

export default async function TeamPage() {
  const session = await requireDashboardSession();
  const org = session.activeOrg;
  const queryClient = getQueryClient();
  const t = await getTranslations('team');
  if (org) void queryClient.prefetchQuery(membersQueryOptions(await createClient(), org.id));

  return (
    <PageContainer
      pageTitle={t('title')}
      pageDescription={org ? t('description', { name: org.name }) : t('descriptionNoOrg')}
      infoContent={await getTeamInfoContent()}
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
