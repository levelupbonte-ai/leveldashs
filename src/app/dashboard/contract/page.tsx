import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { contractQueryOptions, contractsQueryOptions } from '@/features/contracts/api/queries';
import { pickCurrent } from '@/features/contracts/api/service';
import { ContractView } from '@/features/contracts/components/contract-view';
import { requireDashboardSession } from '@/lib/auth/session';
import { getQueryClient } from '@/lib/query-client';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contract');
  return { title: t('title') };
}

// The contract space: always reachable, also while the organization is locked
// (see the contract gate in src/lib/supabase/proxy.ts and docs/contracts.md).
export default async function ContractPage() {
  const session = await requireDashboardSession();
  const t = await getTranslations('contract');
  const org = session.activeOrg;
  const locked = session.access.state !== 'active';

  if (!org) {
    return (
      <PageContainer pageTitle={t('title')} pageDescription={t('description')}>
        {null}
      </PageContainer>
    );
  }

  const db = await createClient();
  const queryClient = getQueryClient();
  // The list decides which contract is shown, so it is awaited; the detail streams.
  const contracts = await queryClient.fetchQuery(contractsQueryOptions(db, org.id)).catch(() => []);
  const current = pickCurrent(contracts);
  if (current) void queryClient.prefetchQuery(contractQueryOptions(db, current.id));

  return (
    <PageContainer
      pageTitle={t('title')}
      pageDescription={locked ? t('descriptionLocked') : t('description')}
    >
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<Skeleton className='h-96 w-full' />}>
          <ContractView organizationId={org.id} />
        </Suspense>
      </HydrationBoundary>
    </PageContainer>
  );
}
