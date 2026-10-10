import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { integrationQueryOptions } from '@/features/site/api/queries';
import { DevelopersPanel } from '@/features/site/components/developers-panel';
import { SitePage } from '@/features/site/components/site-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.developers');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.developers');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchQuery(integrationQueryOptions(db, websiteId))
      }
    >
      <DevelopersPanel />
    </SitePage>
  );
}
