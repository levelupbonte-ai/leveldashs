import type { Metadata } from 'next';
import type { SearchParams } from 'nuqs/server';
import { getTranslations } from 'next-intl/server';
import { SitePage } from '@/features/site/components/site-page';
import { ProjectRequestsView } from '@/features/project-requests/components/project-requests-view';
import { projectRequestsQueryOptions } from '@/features/project-requests/api/queries';
import { toProjectRequestFilters } from '@/features/project-requests/lib/filters';
import { projectRequestSearchParamsCache } from '@/lib/searchparams';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.projectRequests');
  return { title: t('title') };
}

export default async function Page(props: { searchParams: Promise<SearchParams> }) {
  const filters = toProjectRequestFilters(
    projectRequestSearchParamsCache.parse(await props.searchParams)
  );
  const t = await getTranslations('site.pages.projectRequests');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      feature='project_requests'
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchQuery(projectRequestsQueryOptions(db, websiteId, filters))
      }
    >
      <ProjectRequestsView />
    </SitePage>
  );
}
