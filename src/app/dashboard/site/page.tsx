import type { Metadata } from 'next';
import type { SearchParams } from 'nuqs/server';
import { getTranslations } from 'next-intl/server';
import { SitePage } from '@/features/site/components/site-page';
import { SiteDashboard } from '@/features/insights/components/site-dashboard';
import {
  capabilitiesQueryOptions,
  overviewStatsQueryOptions
} from '@/features/insights/api/queries';
import { rangeSearchParamsCache } from '@/lib/searchparams';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.overview');
  return { title: t('title') };
}

export default async function Page(props: { searchParams: Promise<SearchParams> }) {
  const { range } = rangeSearchParamsCache.parse(await props.searchParams);
  const t = await getTranslations('site.pages.overview');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) => {
        void qc.prefetchQuery(overviewStatsQueryOptions(db, websiteId, range));
        void qc.prefetchQuery(capabilitiesQueryOptions(db, websiteId));
      }}
    >
      <SiteDashboard />
    </SitePage>
  );
}
