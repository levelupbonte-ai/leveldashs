import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { plansQueryOptions } from '@/features/platform-admin/api/queries';
import { PlansAdmin } from '@/features/platform-admin/components/billing/plans-admin';
import { staffMessages } from '@/i18n/client-messages';
import { requireDashboardSession } from '@/lib/auth/session';
import { getQueryClient } from '@/lib/query-client';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.billing');
  return { title: t('plansTitle') };
}

// LevelUp staff only: plan prices, limits and features (admin_save_plan, audited).
export default async function AdminPlansPage() {
  const session = await requireDashboardSession();
  if (!session.isPlatformAdmin) notFound();

  const t = await getTranslations('admin.billing');
  const messages = staffMessages(await getMessages());
  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(plansQueryOptions(await createClient()));

  return (
    <PageContainer pageTitle={t('plansTitle')} pageDescription={t('plansDescription')}>
      <NextIntlClientProvider messages={messages}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <Suspense fallback={<Skeleton className='h-96 w-full' />}>
            <PlansAdmin />
          </Suspense>
        </HydrationBoundary>
      </NextIntlClientProvider>
    </PageContainer>
  );
}
