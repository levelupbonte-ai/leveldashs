'use client';

import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { messagesQueryOptions } from '../api/queries';
import type { ChatConversation, ChatMessage, VisitorStatus } from '../api/types';
import { useChatFormat } from '../hooks/use-chat-format';
import type { useChatActions } from '../hooks/use-chat-actions';
import { groupMessages } from '../lib/grouping';
import { ChatHeader } from './chat-header';
import { MessageGroupView } from './message-bubble';
import { MessageComposer } from './message-composer';

interface ChatAreaProps {
  conversation: ChatConversation;
  name: string;
  organizationName: string;
  canManageVisitors: boolean;
  actions: ReturnType<typeof useChatActions>;
  onBack: () => void;
}

export function ChatArea({
  conversation,
  name,
  organizationName,
  canManageVisitors,
  actions,
  onBack
}: ChatAreaProps) {
  const t = useTranslations('chat');
  const { dayLabel, timeZone } = useChatFormat();
  const { db } = actions;
  const query = useSuspenseInfiniteQuery(messagesQueryOptions(db, conversation.id));
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  const messages = useMemo(
    () => query.data.pages.toReversed().flatMap((page) => page.messages),
    [query.data.pages]
  );
  const sections = useMemo(() => groupMessages(messages, timeZone), [messages, timeZone]);

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef<number | null>(null);

  // Keep the view at the bottom for new messages; keep the position when older
  // messages are prepended.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
      return;
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Older history when the top is visible.
  useEffect(() => {
    const el = topRef.current;
    const root = scrollRef.current;
    if (!el || !root || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          prevHeight.current = root.scrollHeight;
          void fetchNextPage();
        }
      },
      { root, rootMargin: '200px 0px 0px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Mark as read when opened and when someone else writes while it is open.
  const { mutate: markRead } = actions.read;
  const lastOther = messages.findLast((m) => !m.mine && !m.pending)?.id;
  const hasUnread = conversation.unread > 0;
  useEffect(() => {
    if (!lastOther && !hasUnread) return;
    if (document.visibilityState === 'visible') markRead(conversation.id);
  }, [conversation.id, lastOther, hasUnread, markRead]);

  // Screen readers hear new messages from others.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!liveRef.current || !last || last.mine || !last.body) return;
    liveRef.current.textContent = `${last.sender_name ?? ''}: ${last.body}`;
  }, [messages]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const isVisitor = conversation.kind === 'visitor';
  const formerPeer = conversation.kind === 'direct' && conversation.peer?.is_member === false;
  const readOnlyReason =
    isVisitor && !canManageVisitors
      ? t('composer.readOnlyViewer')
      : formerPeer
        ? t('composer.readOnlyFormer', { name })
        : null;
  const placeholder =
    conversation.kind === 'team'
      ? t('composer.placeholder.team')
      : conversation.kind === 'direct'
        ? t('composer.placeholder.direct', { name })
        : t('composer.placeholder.visitor');

  const send = (body: string) => {
    stickToBottom.current = true;
    actions.sendText(conversation.id, body, replyTo ? toPreview(replyTo) : null);
    setReplyTo(null);
  };

  const editLast = () => {
    const mine = messages.findLast((m) => m.mine && !m.deleted_at && !m.pending);
    if (mine) setEditing(mine);
  };

  const emptyKey = conversation.kind === 'visitor' ? 'visitor' : conversation.kind;

  return (
    <section
      aria-label={t('thread.label', { name })}
      className='border-border/40 bg-background/80 flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-2xl border p-3 backdrop-blur sm:gap-4 sm:p-4 lg:rounded-3xl'
    >
      <ChatHeader
        db={db}
        conversation={conversation}
        name={name}
        canManageVisitors={canManageVisitors}
        onBack={onBack}
        onToggleMute={() =>
          actions.mute.mutate({ conversationId: conversation.id, muted: !conversation.muted })
        }
        onVisitorStatus={(status: VisitorStatus) =>
          actions.visitorStatus.mutate({ conversationId: conversation.id, status })
        }
      />

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className='[&::-webkit-scrollbar-thumb]:bg-muted relative min-h-0 flex-1 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full'
      >
        <div ref={topRef} aria-hidden='true' className='h-px' />
        {isFetchingNextPage ? (
          <p className='text-muted-foreground flex items-center justify-center gap-2 py-2 text-xs'>
            <Icons.spinner className='size-3.5 animate-spin' aria-hidden='true' />
            {t('thread.loadingOlder')}
          </p>
        ) : !hasNextPage && messages.length > 0 ? (
          <p className='text-muted-foreground py-2 text-center text-xs'>{t('thread.beginning')}</p>
        ) : null}

        {messages.length === 0 ? (
          <Empty className='h-full border-none'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Icons.chat />
              </EmptyMedia>
              <EmptyTitle>{t(`thread.empty.${emptyKey}.title`)}</EmptyTitle>
              <EmptyDescription>
                {t(`thread.empty.${emptyKey}.description`, { org: organizationName, name })}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className='space-y-4 pb-1'>
            {sections.map((section) => (
              <li key={section.day} className='space-y-3'>
                <div
                  className='flex items-center gap-3'
                  role='separator'
                  aria-label={dayLabel(section.day)}
                >
                  <span className='bg-border/60 h-px flex-1' />
                  <span
                    className='text-muted-foreground text-[0.7rem] font-medium'
                    suppressHydrationWarning
                  >
                    {dayLabel(section.day)}
                  </span>
                  <span className='bg-border/60 h-px flex-1' />
                </div>
                {section.groups.map((group) => (
                  <MessageGroupView
                    key={group.key}
                    group={group}
                    canReply={!readOnlyReason}
                    onReply={(m) => {
                      setEditing(null);
                      setReplyTo(m);
                    }}
                    onEdit={(m) => {
                      setReplyTo(null);
                      setEditing(m);
                    }}
                    onDelete={setDeleting}
                    onRetry={actions.retry}
                  />
                ))}
              </li>
            ))}
          </ol>
        )}
      </div>

      <MessageComposer
        conversationId={conversation.id}
        placeholder={placeholder}
        readOnlyReason={readOnlyReason}
        securityNote={t('security', { org: organizationName })}
        replyTo={replyTo}
        editing={editing}
        onCancel={() => {
          setReplyTo(null);
          setEditing(null);
        }}
        onSend={send}
        onSaveEdit={(message, body) => {
          actions.edit.mutate({ message, body });
          setEditing(null);
        }}
        onEditLast={editLast}
      />

      <div ref={liveRef} className='sr-only' aria-live='polite' aria-atomic='true' />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDialog.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                if (deleting) actions.remove.mutate(deleting);
                setDeleting(null);
              }}
            >
              {t('deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

const toPreview = (m: ChatMessage) => ({
  id: m.id,
  sender_name: m.sender_name,
  body: m.body ? m.body.slice(0, 200) : null,
  deleted: !!m.deleted_at
});
