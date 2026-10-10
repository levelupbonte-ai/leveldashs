import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import {
  accessRequestsQueryOptions,
  aiInsightsQueryOptions,
  allWebsitesQueryOptions,
  projectRequestsQueryOptions
} from '@/features/platform-admin/api/queries';
import { AccessRequests } from '@/features/platform-admin/components/access-requests';
import { AdminWebsites } from '@/features/platform-admin/components/admin-websites';
import { NewClientForm } from '@/features/platform-admin/components/new-client-form';
import { AiInsights } from '@/features/platform-admin/components/ai-insights';
import { ProjectRequests } from '@/features/platform-admin/components/project-requests';
import { requireDashboardSession } from '@/lib/auth/session';
import { getQueryClient } from '@/lib/query-client';
import { createClient } from '@/lib/supabase/server';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { staffMessages } from '@/i18n/client-messages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.nav');
  return { title: t('levelupAdmin') };
}

// LevelUp staff only (public.platform_admins). RLS returns every website to
// platform admins; for anyone else this page does not exist: notFound() runs
// before anything is rendered, so neither the staff components nor their
// wording (the `admin` messages, given by the provider below) reach the browser.
export default async function AdminPage() {
  const session = await requireDashboardSession();
  if (!session.isPlatformAdmin) notFound();

  const t = await getTranslations('admin.page');
  const messages = staffMessages(await getMessages());
  const queryClient = getQueryClient();
  const db = await createClient();
  void queryClient.prefetchQuery(allWebsitesQueryOptions(db));
  void queryClient.prefetchQuery(accessRequestsQueryOptions(db));
  void queryClient.prefetchQuery(projectRequestsQueryOptions(db));
  void queryClient.prefetchQuery(aiInsightsQueryOptions(db));

  return (
    <PageContainer pageTitle={t('title')} pageDescription={t('description')}>
      <NextIntlClientProvider messages={messages}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <div className='space-y-6'>
            <Suspense fallback={<Skeleton className='h-32 w-full' />}>
              <AccessRequests />
            </Suspense>
            <Suspense fallback={<Skeleton className='h-64 w-full' />}>
              <ProjectRequests />
            </Suspense>
            <NewClientForm />
            <Suspense fallback={<Skeleton className='h-64 w-full' />}>
              <AdminWebsites />
            </Suspense>
            <Suspense fallback={<Skeleton className='h-96 w-full' />}>
              <AiInsights />
            </Suspense>
          </div>
        </HydrationBoundary>
      </NextIntlClientProvider>
    </PageContainer>
  );
}
