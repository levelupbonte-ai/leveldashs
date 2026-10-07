import { appointmentsQueryOptions } from '@/features/site/api/queries';
import { AppointmentsTable } from '@/features/site/components/appointments-table';
import { SitePage } from '@/features/site/components/site-page';

export const metadata = { title: 'Rendez-vous' };

export default function Page() {
  return (
    <SitePage
      title='Rendez-vous'
      description='Réservations faites depuis votre site'
      feature='bookings'
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchQuery(appointmentsQueryOptions(db, websiteId))
      }
    >
      <AppointmentsTable />
    </SitePage>
  );
}
