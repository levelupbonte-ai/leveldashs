import { submissionsQueryOptions } from '@/features/site/api/queries';
import { SitePage } from '@/features/site/components/site-page';
import { SubmissionsList } from '@/features/site/components/submissions-list';

export const metadata = { title: 'Demandes' };

export default function Page() {
  return (
    <SitePage
      title='Demandes'
      description='Formulaires de contact, devis et inscriptions'
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchQuery(submissionsQueryOptions(db, websiteId))
      }
    >
      <SubmissionsList />
    </SitePage>
  );
}
