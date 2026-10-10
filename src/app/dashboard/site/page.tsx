import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { overviewQueryOptions } from '@/features/site/api/queries';
import { SitePage } from '@/features/site/components/site-page';
import { SiteOverviewCards } from '@/features/site/components/site-overview';
import { WeeklySummaryCard } from '@/features/assistant/components/weekly-summary';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.overview');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.overview');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) => void qc.prefetchQuery(overviewQueryOptions(db, websiteId))}
    >
      <div className='space-y-4'>
        <SiteOverviewCards />
        <WeeklySummaryCard />
      </div>
    </SitePage>
  );
}
