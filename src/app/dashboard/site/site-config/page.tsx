import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { configValuesQueryOptions } from '@/features/engage/api/queries';
import { SiteConfigView } from '@/features/engage/components/site-config-view';
import { SitePage } from '@/features/site/components/site-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.siteConfig');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.siteConfig');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchQuery(configValuesQueryOptions(db, websiteId))
      }
    >
      <SiteConfigView />
    </SitePage>
  );
}
