import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SitePage } from '@/features/site/components/site-page';
import { CapabilitiesView } from '@/features/insights/components/capabilities-view';
import { capabilitiesQueryOptions } from '@/features/insights/api/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.capabilities');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.capabilities');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchQuery(capabilitiesQueryOptions(db, websiteId))
      }
    >
      <CapabilitiesView />
    </SitePage>
  );
}
