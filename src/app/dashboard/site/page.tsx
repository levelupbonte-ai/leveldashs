import { overviewQueryOptions } from '@/features/site/api/queries';
import { SitePage } from '@/features/site/components/site-page';
import { SiteOverviewCards } from '@/features/site/components/site-overview';

export const metadata = { title: 'Mon site' };

export default function Page() {
  return (
    <SitePage
      title='Mon site'
      description='Vue d’ensemble'
      prefetch={(qc, db, websiteId) => void qc.prefetchQuery(overviewQueryOptions(db, websiteId))}
    >
      <SiteOverviewCards />
    </SitePage>
  );
}
