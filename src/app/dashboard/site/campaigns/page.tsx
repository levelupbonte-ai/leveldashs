import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { campaignsListQueryOptions } from '@/features/engage/api/queries';
import { CampaignsView } from '@/features/engage/components/campaigns-view';
import { SitePage } from '@/features/site/components/site-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.campaigns');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.campaigns');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchQuery(campaignsListQueryOptions(db, websiteId))
      }
    >
      <CampaignsView />
    </SitePage>
  );
}
