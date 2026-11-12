import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { getBillingInfoContent } from '@/config/infoconfig';
import {
  billingSummaryQueryOptions,
  billingUsageQueryOptions
} from '@/features/billing/api/queries';
import { BillingView } from '@/features/billing/components/billing-view';
import { requireDashboardSession } from '@/lib/auth/session';
import { onlinePaymentMethods, onlinePaymentsProblems } from '@/lib/payments';
import { getQueryClient } from '@/lib/query-client';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('billing');
  return { title: t('title') };
}

function BillingSkeleton() {
  return (
    <div className='space-y-6'>
      <div className='grid gap-6 lg:grid-cols-2'>
        <Skeleton className='h-64 w-full' />
        <Skeleton className='h-64 w-full' />
      </div>
      <Skeleton className='h-40 w-full' />
      <Skeleton className='h-72 w-full' />
    </div>
  );
}

// Every member reaches this page (the database hides the money from editors and
// viewers); the navigation lists it for owners and admins.
export default async function BillingPage() {
  const { activeOrg } = await requireDashboardSession();
  const t = await getTranslations('billing');
  const queryClient = getQueryClient();
  const onlinePayments = onlinePaymentMethods();
  // LevelUp staff see why online payment is off (variable names only), clients never.
  let staffPaymentProblems: string[] = [];
  if (!onlinePayments.length) {
    const db = await createClient();
    const { data: staff } = await db.rpc('billing_viewer_is_staff');
    if (staff === true) staffPaymentProblems = onlinePaymentsProblems();
  }
  if (activeOrg) {
    const db = await createClient();
    void queryClient.prefetchQuery(billingSummaryQueryOptions(db, activeOrg.id));
    void queryClient.prefetchQuery(billingUsageQueryOptions(db, activeOrg.id));
  }

  return (
    <PageContainer
      infoContent={await getBillingInfoContent()}
      pageTitle={t('title')}
      pageDescription={activeOrg ? t('descriptionOrg', { name: activeOrg.name }) : t('description')}
    >
      {activeOrg ? (
        <HydrationBoundary state={dehydrate(queryClient)}>
          <Suspense fallback={<BillingSkeleton />}>
            <BillingView
              organizationId={activeOrg.id}
              onlinePayments={onlinePayments}
              staffPaymentProblems={staffPaymentProblems}
            />
          </Suspense>
        </HydrationBoundary>
      ) : (
        <p className='text-muted-foreground text-sm'>{t('noOrg')}</p>
      )}
    </PageContainer>
  );
}
