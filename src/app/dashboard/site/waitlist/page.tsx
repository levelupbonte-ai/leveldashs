import { waitlistQueryOptions } from '@/features/site/api/queries';
import { SitePage } from '@/features/site/components/site-page';
import { WaitlistBoard } from '@/features/site/components/waitlist-board';

export const metadata = { title: 'File d’attente' };

export default function Page() {
  return (
    <SitePage
      title='File d’attente'
      description='Clients en attente au salon'
      feature='waitlist'
      prefetch={(qc, db, websiteId) => void qc.prefetchQuery(waitlistQueryOptions(db, websiteId))}
    >
      <WaitlistBoard />
    </SitePage>
  );
}
