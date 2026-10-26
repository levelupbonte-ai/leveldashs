import type { Metadata } from 'next';
import type { SearchParams } from 'nuqs/server';
import { getTranslations } from 'next-intl/server';
import { SitePage } from '@/features/site/components/site-page';
import { PaymentsView } from '@/features/payments/components/payments-view';
import { paymentsQueryOptions, paymentsSummaryQueryOptions } from '@/features/payments/api/queries';
import { toPaymentFilters } from '@/features/payments/lib/filters';
import { paymentSearchParamsCache } from '@/lib/searchparams';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.payments');
  return { title: t('title') };
}

export default async function Page(props: { searchParams: Promise<SearchParams> }) {
  const params = paymentSearchParamsCache.parse(await props.searchParams);
  const filters = toPaymentFilters(params);
  const t = await getTranslations('site.pages.payments');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      feature='payments'
      dataKey='payments'
      prefetch={(qc, db, websiteId) => {
        void qc.prefetchQuery(
          paymentsSummaryQueryOptions(db, websiteId, params.range, filters.live)
        );
        void qc.prefetchQuery(paymentsQueryOptions(db, websiteId, filters));
      }}
    >
      <PaymentsView />
    </SitePage>
  );
}
