import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SitePage } from '@/features/site/components/site-page';
import { ActivityLog } from '@/features/insights/components/activity-log';
import { activityLogQueryOptions } from '@/features/insights/api/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.activity');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.activity');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) => {
        void qc.prefetchQuery(activityLogQueryOptions(db, websiteId, 1));
      }}
    >
      <ActivityLog />
    </SitePage>
  );
}
