import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SitePage } from '@/features/site/components/site-page';
import { ClientPortalView } from '@/features/client-portal/components/client-portal-view';
import { portalOverviewQueryOptions } from '@/features/client-portal/api/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.clientPortal');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.clientPortal');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      feature='client_portal'
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchQuery(portalOverviewQueryOptions(db, websiteId))
      }
    >
      <ClientPortalView />
    </SitePage>
  );
}
