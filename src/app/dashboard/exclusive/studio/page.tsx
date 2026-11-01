import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import type { SearchParams } from 'nuqs/server';
import PageContainer from '@/components/layout/page-container';
import {
  studioSitesQueryOptions,
  studioTemplatesQueryOptions
} from '@/features/studio-admin/api/queries';
import { StudioAdmin } from '@/features/studio-admin/components/studio-admin';
import { toStudioSiteFilters } from '@/features/studio-admin/lib/filters';
import { staffMessages } from '@/i18n/client-messages';
import { requireDashboardSession } from '@/lib/auth/session';
import { getQueryClient } from '@/lib/query-client';
import { studioSearchParamsCache } from '@/lib/searchparams';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.studio');
  return { title: t('title') };
}

// LevelUp staff only (platform admin on aal2, checked again by every database
// function): LevelStudio's templates and the sites people created. Read-only
// except publishing a template; every list and preview is audited (studio.viewed).
export default async function AdminStudioPage(props: { searchParams: Promise<SearchParams> }) {
  const session = await requireDashboardSession();
  if (!session.isPlatformAdmin) notFound();

  const params = studioSearchParamsCache.parse(await props.searchParams);
  const t = await getTranslations('admin.studio');
  const messages = staffMessages(await getMessages());
  const queryClient = getQueryClient();
  const db = await createClient();
  // Only the open tab: each list call is an audited view.
  if (params.tab === 'sites') {
    void queryClient.prefetchQuery(studioSitesQueryOptions(db, toStudioSiteFilters(params)));
  } else {
    void queryClient.prefetchQuery(studioTemplatesQueryOptions(db));
  }

  return (
    <PageContainer pageTitle={t('title')} pageDescription={t('description')}>
      <NextIntlClientProvider messages={messages}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <StudioAdmin />
        </HydrationBoundary>
      </NextIntlClientProvider>
    </PageContainer>
  );
}
