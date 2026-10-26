import type { Metadata } from 'next';
import type { SearchParams } from 'nuqs/server';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { Icons } from '@/components/icons';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { conversationsQueryOptions, messagesQueryOptions } from '@/features/chat/api/queries';
import { Messenger, MessengerSkeleton } from '@/features/chat/components/messenger';
import { chatSearchParamsCache, isConversationId } from '@/features/chat/lib/search-params';
import { requireDashboardSession } from '@/lib/auth/session';
import { hasRole } from '@/lib/auth/types';
import { getQueryClient } from '@/lib/query-client';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('chat');
  return { title: t('metadataTitle') };
}

export default async function ChatPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireDashboardSession();
  const t = await getTranslations('chat');
  const org = session.activeOrg;

  // Members only: LevelUp staff do not read client chats unless they are in the team.
  if (!org || !org.role) {
    const key = org ? 'notMember' : 'noOrg';
    return (
      <div className='flex flex-1 items-center justify-center p-4 md:px-6'>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Icons.lock />
            </EmptyMedia>
            <EmptyTitle>{t(`${key}.title`)}</EmptyTitle>
            <EmptyDescription>{t(`${key}.description`, { org: org?.name ?? '' })}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const { c } = await chatSearchParamsCache.parse(searchParams);
  const db = await createClient();
  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(conversationsQueryOptions(db, org.id));
  if (isConversationId(c)) void queryClient.prefetchInfiniteQuery(messagesQueryOptions(db, c));

  return (
    <div className='flex min-h-0 min-w-0 flex-1 px-2 py-2 sm:px-4 md:px-6'>
      <h1 className='sr-only'>{t('pageTitle')}</h1>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<MessengerSkeleton />}>
          <Messenger
            organizationId={org.id}
            organizationName={org.name}
            canManageVisitors={hasRole(org.role, 'editor')}
          />
        </Suspense>
      </HydrationBoundary>
    </div>
  );
}
