import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { appointmentsQueryOptions } from '@/features/site/api/queries';
import { AppointmentsTable } from '@/features/site/components/appointments-table';
import { SitePage } from '@/features/site/components/site-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.appointments');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.appointments');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      feature='bookings'
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchInfiniteQuery(appointmentsQueryOptions(db, websiteId))
      }
    >
      <AppointmentsTable />
    </SitePage>
  );
}
