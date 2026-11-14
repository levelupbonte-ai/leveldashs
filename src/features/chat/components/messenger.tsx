'use client';

import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useQueryStates } from 'nuqs';
import { Suspense, useEffect, useState } from 'react';
import { Icons } from '@/components/icons';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { portalInboxQueryOptions } from '@/features/client-portal/api/queries';
import { useVisualViewport } from '@/hooks/use-visual-viewport';
import { cn } from '@/lib/utils';
import { conversationsQueryOptions } from '../api/queries';
import { useChatActions } from '../hooks/use-chat-actions';
import { useChatRealtime } from '../hooks/use-chat-realtime';
import { chatSearchParams } from '../lib/search-params';
import { ChatArea } from './chat-area';
import { useConversationName } from './conversation-avatar';
import { ConversationList } from './conversation-list';
import { MemberPane } from './member-pane';
import { NewDirectDialog } from './new-direct-dialog';

interface MessengerProps {
  organizationId: string;
  organizationName: string;
  /** Editors and above: visitor contact details, notes, resolve and archive. */
  canManageVisitors: boolean;
  /** Website whose client-portal members also write here (editors+), or null. */
  portalWebsiteId: string | null;
}

export function Messenger({
  organizationId,
  organizationName,
  canManageVisitors,
  portalWebsiteId
}: MessengerProps) {
  const t = useTranslations('chat');
  const actions = useChatActions(organizationId);
  const { db } = actions;
  const nameOf = useConversationName();
  const [{ c: selectedId, m: memberId, tab }, setParams] = useQueryStates(chatSearchParams, {
    history: 'push'
  });
  const [showArchived, setShowArchived] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const open = useSuspenseQuery(conversationsQueryOptions(db, organizationId));
  const archived = useQuery({
    ...conversationsQueryOptions(db, organizationId, true),
    enabled: showArchived
  });
  const conversations = (showArchived && archived.data) || open.data;
  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  // Members of the client portal (Black Pater…): their messages live here too.
  const portal = useQuery({
    ...portalInboxQueryOptions(db, portalWebsiteId ?? ''),
    enabled: !!portalWebsiteId
  });
  const members = portalWebsiteId ? (portal.data ?? []) : null;
  const member = (memberId && members?.find((m) => m.id === memberId)) || null;
  const paneOpen = !!(selected || member);
  // Phones: with the keyboard open the chat fills the visible area (reply box in view).
  const visible = useVisualViewport(paneOpen);

  const { live } = useChatRealtime(organizationId, selected?.id ?? null);

  // An unknown or no longer visible conversation in the URL is dropped.
  useEffect(() => {
    if (selectedId && !selected && !archived.isFetching) void setParams({ c: null });
  }, [selectedId, selected, archived.isFetching, setParams]);

  const select = (id: string | null) => void setParams({ c: id, m: null });
  const selectMember = (id: string | null) => void setParams({ m: id, c: null });

  return (
    <div
      className={cn(
        'border-border/50 bg-background/70 relative grid h-[calc(100dvh-5.5rem)] w-full min-w-0 gap-3 overflow-hidden rounded-2xl border p-2 backdrop-blur-xl sm:p-3 lg:[grid-template-columns:minmax(18rem,30%)_1fr] lg:gap-4 lg:rounded-3xl lg:p-5',
        visible && 'fixed inset-x-0 z-50 rounded-none'
      )}
      style={visible ? { top: visible.top, height: visible.height } : undefined}
    >
      <ConversationList
        className={cn(paneOpen && 'hidden lg:flex')}
        conversations={conversations}
        selectedId={selected?.id ?? null}
        onSelect={select}
        members={members}
        selectedMemberId={member?.id ?? null}
        onSelectMember={selectMember}
        tab={tab}
        onTabChange={(next) => void setParams({ tab: next })}
        onNewMessage={() => setNewOpen(true)}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((v) => !v)}
        live={live}
      />

      <div className={cn('min-h-0 min-w-0', !paneOpen && 'hidden lg:block')}>
        {member ? (
          <MemberPane member={member} keyboard={!!visible} onBack={() => selectMember(null)} />
        ) : selected ? (
          <Suspense key={selected.id} fallback={<ThreadSkeleton />}>
            <ChatArea
              conversation={selected}
              name={nameOf(selected)}
              organizationName={organizationName}
              canManageVisitors={canManageVisitors}
              actions={actions}
              onBack={() => select(null)}
            />
          </Suspense>
        ) : (
          <div className='border-border/40 bg-background/80 flex h-full items-center justify-center rounded-2xl border lg:rounded-3xl'>
            <Empty className='border-none'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Icons.chat />
                </EmptyMedia>
                <EmptyTitle>{t('thread.select.title')}</EmptyTitle>
                <EmptyDescription>{t('thread.select.description')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </div>

      <NewDirectDialog
        db={db}
        organizationId={organizationId}
        organizationName={organizationName}
        open={newOpen}
        onOpenChange={setNewOpen}
        pending={actions.direct.isPending}
        onPick={(userId) =>
          actions.direct.mutate(userId, {
            onSuccess: (id) => {
              setNewOpen(false);
              void open.refetch().then(() => setParams({ c: id, tab: 'all' }));
            }
          })
        }
      />
    </div>
  );
}

export function MessengerSkeleton() {
  return (
    <div className='border-border/50 grid h-[calc(100dvh-5.5rem)] w-full gap-4 rounded-3xl border p-5 lg:[grid-template-columns:minmax(18rem,30%)_1fr]'>
      <div className='space-y-3'>
        <Skeleton className='h-10 w-full rounded-2xl' />
        <Skeleton className='h-9 w-full rounded-2xl' />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className='h-16 w-full rounded-2xl' />
        ))}
      </div>
      <Skeleton className='hidden h-full rounded-3xl lg:block' />
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className='border-border/40 flex h-full flex-col gap-4 rounded-3xl border p-4'>
      <Skeleton className='h-12 w-64 rounded-2xl' />
      <div className='flex-1 space-y-3'>
        <Skeleton className='h-14 w-2/3 rounded-2xl' />
        <Skeleton className='ml-auto h-14 w-1/2 rounded-2xl' />
        <Skeleton className='h-14 w-3/5 rounded-2xl' />
      </div>
      <Skeleton className='h-16 w-full rounded-3xl' />
    </div>
  );
}
