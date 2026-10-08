import { overviewQueryOptions } from '@/features/site/api/queries';
import { SitePage } from '@/features/site/components/site-page';
import { SiteOverviewCards } from '@/features/site/components/site-overview';
import { WeeklySummaryCard } from '@/features/assistant/components/weekly-summary';

export const metadata = { title: 'Mon site' };

export default function Page() {
  return (
    <SitePage
      title='Mon site'
      description='Vue d’ensemble'
      prefetch={(qc, db, websiteId) => void qc.prefetchQuery(overviewQueryOptions(db, websiteId))}
    >
      <div className='space-y-4'>
        <SiteOverviewCards />
        <WeeklySummaryCard />
      </div>
    </SitePage>
  );
}
