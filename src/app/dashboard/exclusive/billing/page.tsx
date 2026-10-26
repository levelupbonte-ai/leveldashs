import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import {
  billingOrgsQueryOptions,
  upgradeRequestsQueryOptions
} from '@/features/platform-admin/api/queries';
import {
  BillingOrgs,
  UpgradeRequests
} from '@/features/platform-admin/components/billing/billing-admin';
import { staffMessages } from '@/i18n/client-messages';
import { requireDashboardSession } from '@/lib/auth/session';
import { getQueryClient } from '@/lib/query-client';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.billing');
  return { title: t('pageTitle') };
}

// LevelUp staff only (platform_admins). Every billing function checks the caller
// and an aal2 session in the database and writes the audit log; nobody else gets
// this page or its wording.
export default async function AdminBillingPage() {
  const session = await requireDashboardSession();
  if (!session.isPlatformAdmin) notFound();

  const t = await getTranslations('admin.billing');
  const messages = staffMessages(await getMessages());
  const queryClient = getQueryClient();
  const db = await createClient();
  void queryClient.prefetchQuery(upgradeRequestsQueryOptions(db));
  void queryClient.prefetchQuery(billingOrgsQueryOptions(db));

  return (
    <PageContainer pageTitle={t('pageTitle')} pageDescription={t('pageDescription')}>
      <NextIntlClientProvider messages={messages}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <div className='space-y-6'>
            <Suspense fallback={<Skeleton className='h-32 w-full' />}>
              <UpgradeRequests />
            </Suspense>
            <Suspense fallback={<Skeleton className='h-96 w-full' />}>
              <BillingOrgs />
            </Suspense>
          </div>
        </HydrationBoundary>
      </NextIntlClientProvider>
    </PageContainer>
  );
}
