'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ChatConversation, ConversationKind } from '../api/types';
import { CHAT_TABS, type ChatTab } from '../lib/search-params';
import { useChatFormat } from '../hooks/use-chat-format';
import { ConversationAvatar, useConversationName } from './conversation-avatar';

const TAB_KIND: Record<Exclude<ChatTab, 'all'>, ConversationKind> = {
  team: 'team',
  direct: 'direct',
  visitors: 'visitor'
};

interface ConversationListProps {
  conversations: ChatConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  tab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
  onNewMessage: () => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  live: boolean;
  className?: string;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  tab,
  onTabChange,
  onNewMessage,
  showArchived,
  onToggleArchived,
  live,
  className
}: ConversationListProps) {
  const t = useTranslations('chat');
  const nameOf = useConversationName();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (tab !== 'all' && c.kind !== TAB_KIND[tab]) return false;
      if (!q) return true;
      const haystack = [nameOf(c), c.visitor?.email, c.visitor?.website_name, c.last_message?.body]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [conversations, tab, search, nameOf]);

  const sections: { kind: ConversationKind; items: ChatConversation[] }[] = (
    ['team', 'direct', 'visitor'] as ConversationKind[]
  )
    .filter((kind) => tab === 'all' || TAB_KIND[tab] === kind)
    .map((kind) => ({ kind, items: filtered.filter((c) => c.kind === kind) }));

  const sectionTitle = (kind: ConversationKind) =>
    kind === 'team'
      ? t('sections.team')
      : kind === 'direct'
        ? t('sections.direct')
        : t('sections.visitors');

  return (
    <div
      className={cn(
        'border-border/40 bg-background/75 flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-2xl border p-3 backdrop-blur lg:rounded-3xl lg:p-4',
        className
      )}
    >
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <h2 className='text-foreground text-sm font-semibold'>{t('list.title')}</h2>
          <p className='text-muted-foreground flex items-center gap-1.5 text-xs'>
            <span
              aria-hidden='true'
              className={cn(
                'inline-block size-1.5 rounded-full',
                live ? 'bg-emerald-500' : 'bg-muted-foreground/50'
              )}
            />
            {t('list.count', { count: conversations.length })}
            <span className='sr-only'>{live ? t('live.live') : t('live.polling')}</span>
          </p>
        </div>
        <Button
          type='button'
          size='sm'
          variant='outline'
          className='border-border/50 rounded-full'
          onClick={onNewMessage}
        >
          <Icons.add aria-hidden='true' />
          {t('list.newMessage')}
        </Button>
      </div>

      <div className='relative'>
        <Icons.search
          className='text-muted-foreground/70 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2'
          aria-hidden='true'
        />
        <Input
          type='search'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('list.search')}
          aria-label={t('list.search')}
          maxLength={100}
          className='border-border/40 bg-background/60 placeholder:text-muted-foreground/70 focus-visible:ring-primary/40 w-full rounded-2xl pl-10 text-sm focus-visible:ring-2'
        />
      </div>

      <div
        role='group'
        aria-label={t('list.label')}
        className='bg-muted/60 grid grid-cols-4 gap-1 rounded-2xl p-1'
      >
        {CHAT_TABS.map((key) => {
          const unread = conversations
            .filter((c) => key === 'all' || c.kind === TAB_KIND[key as Exclude<ChatTab, 'all'>])
            .reduce((n, c) => n + (c.muted ? 0 : c.unread), 0);
          return (
            <button
              key={key}
              type='button'
              aria-pressed={tab === key}
              onClick={() => onTabChange(key)}
              className={cn(
                'focus-visible:ring-primary/50 relative rounded-xl px-2 py-1.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:outline-none',
                tab === key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(`tabs.${key}`)}
              {unread > 0 && key !== 'all' ? (
                <span
                  aria-hidden='true'
                  className='bg-primary absolute top-1 right-1.5 size-1.5 rounded-full'
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <nav
        aria-label={t('list.label')}
        className='-mr-1 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1'
      >
        {search.trim() && filtered.length === 0 ? (
          <p className='text-muted-foreground py-8 text-center text-xs'>{t('list.noMatch')}</p>
        ) : (
          sections.map(({ kind, items }) => (
            <section key={kind} aria-label={sectionTitle(kind)} className='space-y-1.5'>
              {tab === 'all' ? (
                <h3 className='text-muted-foreground px-1 text-[0.7rem] font-semibold tracking-wide uppercase'>
                  {sectionTitle(kind)}
                </h3>
              ) : null}
              {items.length === 0 && !search.trim() && kind !== 'team' ? (
                <p className='text-muted-foreground px-1 py-2 text-xs leading-relaxed'>
                  {kind === 'direct' ? t('emptySection.direct') : t('emptySection.visitors')}
                </p>
              ) : null}
              <ul className='space-y-1.5'>
                {items.map((c) => (
                  <li key={c.id}>
                    <ConversationItem
                      conversation={c}
                      name={nameOf(c)}
                      active={c.id === selectedId}
                      onSelect={() => onSelect(c.id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {tab === 'all' || tab === 'visitors' ? (
          <button
            type='button'
            onClick={onToggleArchived}
            className='text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-1 text-xs'
          >
            <Icons.archive className='size-3.5' aria-hidden='true' />
            {showArchived ? t('list.hideArchived') : t('list.showArchived')}
          </button>
        ) : null}
      </nav>
    </div>
  );
}

interface ConversationItemProps {
  conversation: ChatConversation;
  name: string;
  active: boolean;
  onSelect: () => void;
}

function ConversationItem({ conversation: c, name, active, onSelect }: ConversationItemProps) {
  const t = useTranslations('chat');
  const { listTime } = useChatFormat();
  const last = c.last_message;
  const unread = c.muted ? 0 : c.unread;

  let preview = t('preview.empty');
  if (last?.deleted) preview = t('preview.deleted');
  else if (last?.body) {
    const text = last.body.replace(/\s+/g, ' ');
    preview = last.mine
      ? t('preview.you', { text })
      : last.kind === 'note'
        ? t('preview.note', { text })
        : c.kind === 'team'
          ? `${last.sender_name ?? ''}: ${text}`
          : text;
  }

  return (
    <button
      type='button'
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'focus-visible:ring-primary/50 focus-visible:ring-offset-background flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        active
          ? 'border-primary/40 bg-primary/10'
          : 'bg-background/70 hover:border-border/40 hover:bg-muted/40 border-transparent',
        (c.resolved_at || c.archived_at) && !active && 'opacity-75'
      )}
    >
      <ConversationAvatar conversation={c} name={name} />
      <span className='min-w-0 flex-1 space-y-0.5'>
        <span className='flex items-start justify-between gap-2'>
          <span
            className={cn(
              'text-foreground truncate text-sm',
              unread ? 'font-semibold' : 'font-medium'
            )}
          >
            {name}
          </span>
          <span className='text-muted-foreground shrink-0 text-[0.65rem]' suppressHydrationWarning>
            {listTime(last?.created_at ?? c.last_message_at)}
          </span>
        </span>
        {c.kind === 'visitor' && c.visitor?.website_name ? (
          <span className='text-muted-foreground block truncate text-[0.7rem]'>
            {c.visitor.website_name}
          </span>
        ) : null}
        <span className='flex items-center gap-2'>
          <span
            className={cn(
              'line-clamp-1 flex-1 text-xs',
              unread ? 'text-foreground' : 'text-muted-foreground',
              last?.deleted && 'italic'
            )}
          >
            {preview}
          </span>
          {c.muted ? (
            <Icons.bellOff
              className='text-muted-foreground size-3.5 shrink-0'
              aria-label={t('status.muted')}
            />
          ) : null}
          {c.archived_at ? (
            <StatusPill label={t('status.archived')} />
          ) : c.resolved_at ? (
            <StatusPill label={t('status.resolved')} />
          ) : null}
          {unread > 0 ? (
            <span className='bg-primary text-primary-foreground inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[0.65rem] font-semibold'>
              <span aria-hidden='true'>{unread > 99 ? '99+' : unread}</span>
              <span className='sr-only'>{t('unreadLabel', { count: unread })}</span>
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className='border-border/60 text-muted-foreground shrink-0 rounded-full border px-1.5 py-px text-[0.6rem] font-medium'>
      {label}
    </span>
  );
}
