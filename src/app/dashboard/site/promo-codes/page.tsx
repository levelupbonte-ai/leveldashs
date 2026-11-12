import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { promoCodesQueryOptions } from '@/features/engage/api/queries';
import { PromoCodesView } from '@/features/engage/components/promo-codes-view';
import { SitePage } from '@/features/site/components/site-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.promoCodes');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.promoCodes');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) => void qc.prefetchQuery(promoCodesQueryOptions(db, websiteId))}
    >
      <PromoCodesView />
    </SitePage>
  );
}
