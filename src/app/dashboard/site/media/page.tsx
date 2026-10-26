import type { Metadata } from 'next';
import type { SearchParams } from 'nuqs/server';
import { getTranslations } from 'next-intl/server';
import { mediaQueryOptions, mediaStatsQueryOptions } from '@/features/site/api/queries';
import { MediaLibrary } from '@/features/site/components/media-library';
import { SitePage } from '@/features/site/components/site-page';
import { toMediaFilters } from '@/features/site/lib/media-filters';
import { mediaSearchParamsCache } from '@/lib/searchparams';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.media');
  return { title: t('title') };
}

export default async function Page(props: { searchParams: Promise<SearchParams> }) {
  const filters = toMediaFilters(mediaSearchParamsCache.parse(await props.searchParams));
  const t = await getTranslations('site.pages.media');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) => {
        void qc.prefetchInfiniteQuery(mediaQueryOptions(db, websiteId, filters));
        void qc.prefetchQuery(mediaStatsQueryOptions(db, websiteId));
      }}
    >
      <MediaLibrary />
    </SitePage>
  );
}
