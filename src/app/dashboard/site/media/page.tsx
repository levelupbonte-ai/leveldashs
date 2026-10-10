import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { mediaQueryOptions } from '@/features/site/api/queries';
import { MediaLibrary } from '@/features/site/components/media-library';
import { SitePage } from '@/features/site/components/site-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.media');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.media');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchInfiniteQuery(mediaQueryOptions(db, websiteId))
      }
    >
      <MediaLibrary />
    </SitePage>
  );
}
