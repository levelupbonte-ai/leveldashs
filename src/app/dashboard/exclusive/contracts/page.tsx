import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import {
  allWebsitesQueryOptions,
  contractTemplatesQueryOptions
} from '@/features/platform-admin/api/queries';
import { ContractsAdmin } from '@/features/platform-admin/components/contracts-admin';
import { staffMessages } from '@/i18n/client-messages';
import { requireDashboardSession } from '@/lib/auth/session';
import { getQueryClient } from '@/lib/query-client';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.contracts');
  return { title: t('pageTitle') };
}

// LevelUp staff only (platform_admins): every write goes through RPCs that check
// the caller and require an aal2 session. Nobody else gets this page or its wording.
export default async function AdminContractsPage() {
  const session = await requireDashboardSession();
  if (!session.isPlatformAdmin) notFound();

  const t = await getTranslations('admin.contracts');
  const messages = staffMessages(await getMessages());
  const queryClient = getQueryClient();
  const db = await createClient();
  void queryClient.prefetchQuery(contractTemplatesQueryOptions(db));
  void queryClient.prefetchQuery(allWebsitesQueryOptions(db));

  return (
    <PageContainer pageTitle={t('pageTitle')} pageDescription={t('pageDescription')}>
      <NextIntlClientProvider messages={messages}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <Suspense fallback={<Skeleton className='h-64 w-full' />}>
            <ContractsAdmin />
          </Suspense>
        </HydrationBoundary>
      </NextIntlClientProvider>
    </PageContainer>
  );
}
