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
  discountsQueryOptions
} from '@/features/platform-admin/api/queries';
import { DiscountsAdmin } from '@/features/platform-admin/components/billing/discounts-admin';
import { staffMessages } from '@/i18n/client-messages';
import { requireDashboardSession } from '@/lib/auth/session';
import { getQueryClient } from '@/lib/query-client';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.billing');
  return { title: t('discountsTitle') };
}

// LevelUp staff only: organization discounts and promo codes (admin_save_discount, audited).
export default async function AdminDiscountsPage() {
  const session = await requireDashboardSession();
  if (!session.isPlatformAdmin) notFound();

  const t = await getTranslations('admin.billing');
  const messages = staffMessages(await getMessages());
  const queryClient = getQueryClient();
  const db = await createClient();
  void queryClient.prefetchQuery(discountsQueryOptions(db));
  void queryClient.prefetchQuery(billingOrgsQueryOptions(db));

  return (
    <PageContainer pageTitle={t('discountsTitle')} pageDescription={t('discountsDescription')}>
      <NextIntlClientProvider messages={messages}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <Suspense fallback={<Skeleton className='h-96 w-full' />}>
            <DiscountsAdmin />
          </Suspense>
        </HydrationBoundary>
      </NextIntlClientProvider>
    </PageContainer>
  );
}
