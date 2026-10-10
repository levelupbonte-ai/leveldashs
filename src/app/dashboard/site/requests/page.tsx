import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { submissionsQueryOptions } from '@/features/site/api/queries';
import { SitePage } from '@/features/site/components/site-page';
import { SubmissionsList } from '@/features/site/components/submissions-list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.requests');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.requests');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchInfiniteQuery(submissionsQueryOptions(db, websiteId))
      }
    >
      <SubmissionsList />
    </SitePage>
  );
}
