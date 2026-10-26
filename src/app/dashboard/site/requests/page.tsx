import type { Metadata } from 'next';
import type { SearchParams } from 'nuqs/server';
import { getTranslations } from 'next-intl/server';
import { SitePage } from '@/features/site/components/site-page';
import { FormsInbox } from '@/features/submissions/components/forms-inbox';
import { submissionPageQueryOptions } from '@/features/submissions/api/queries';
import { toSubmissionFilters } from '@/features/submissions/lib/filters';
import { capabilitiesQueryOptions } from '@/features/insights/api/queries';
import { submissionSearchParamsCache } from '@/lib/searchparams';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.requests');
  return { title: t('title') };
}

export default async function Page(props: { searchParams: Promise<SearchParams> }) {
  const filters = toSubmissionFilters(submissionSearchParamsCache.parse(await props.searchParams));
  const t = await getTranslations('site.pages.requests');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) => {
        void qc.prefetchQuery(submissionPageQueryOptions(db, websiteId, filters));
        void qc.prefetchQuery(capabilitiesQueryOptions(db, websiteId));
      }}
    >
      <FormsInbox />
    </SitePage>
  );
}
