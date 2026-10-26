'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type { SupabaseClient } from '@supabase/supabase-js';
import { visitorContactQueryOptions } from '../api/queries';
import type { ChatConversation, VisitorStatus } from '../api/types';
import { replyMailto } from '../lib/message-text';
import { ConversationAvatar } from './conversation-avatar';

interface ChatHeaderProps {
  db: SupabaseClient;
  conversation: ChatConversation;
  name: string;
  /** Editors and above: visitor contact, resolve and archive. */
  canManageVisitors: boolean;
  onBack: () => void;
  onToggleMute: () => void;
  onVisitorStatus: (status: VisitorStatus) => void;
}

const iconButton =
  'border-border/40 bg-background/60 text-muted-foreground hover:bg-muted/60 size-9 rounded-full border sm:size-10';

export function ChatHeader({
  db,
  conversation: c,
  name,
  canManageVisitors,
  onBack,
  onToggleMute,
  onVisitorStatus
}: ChatHeaderProps) {
  const t = useTranslations('chat');
  const isVisitor = c.kind === 'visitor';
  const contact = useQuery({
    ...visitorContactQueryOptions(db, c.id),
    enabled: isVisitor && canManageVisitors && !!c.visitor?.has_email
  });

  const subtitle =
    c.kind === 'team'
      ? t('teamSubtitle', { count: c.member_count ?? 0 })
      : c.kind === 'direct'
        ? c.peer?.is_member === false
          ? t('formerMember')
          : t('directSubtitle')
        : t('visitorSubtitle', { site: c.visitor?.website_name ?? '' });

  const mailto =
    isVisitor && contact.data
      ? replyMailto(
          contact.data.email,
          t('actions.emailSubject', { site: contact.data.website_name ?? '' }),
          t('actions.emailGreeting', { name: contact.data.name ?? '' })
        )
      : null;

  return (
    <header className='flex flex-wrap items-center justify-between gap-3'>
      <div className='flex min-w-0 items-center gap-2 sm:gap-3'>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className={`${iconButton} lg:hidden`}
          onClick={onBack}
          aria-label={t('thread.back')}
        >
          <Icons.chevronLeft className='size-4' />
        </Button>
        <ConversationAvatar conversation={c} name={name} size='lg' />
        <div className='min-w-0'>
          <h2 className='text-foreground truncate text-sm font-semibold sm:text-base'>{name}</h2>
          <p className='text-muted-foreground truncate text-xs sm:text-sm'>
            {subtitle}
            {isVisitor && c.visitor?.email ? <span> · {c.visitor.email}</span> : null}
          </p>
          {isVisitor ? (
            <p className='text-muted-foreground/80 flex items-center gap-1 text-[0.7rem]'>
              <Icons.info className='size-3' aria-hidden='true' />
              {t('visitorUnverified')} · {t(`source.${c.visitor?.source ?? 'form'}`)}
            </p>
          ) : null}
        </div>
      </div>

      <div className='flex items-center gap-1.5 sm:gap-2'>
        {isVisitor && canManageVisitors ? (
          mailto ? (
            <Button
              variant='outline'
              size='sm'
              className='border-border/50 rounded-full'
              nativeButton={false}
              render={<a href={mailto} aria-label={t('actions.replyByEmail')} />}
            >
              <Icons.mail aria-hidden='true' />
              <span className='hidden sm:inline'>{t('actions.replyByEmail')}</span>
            </Button>
          ) : (
            <Button
              variant='outline'
              size='sm'
              className='border-border/50 rounded-full'
              disabled
              title={t('actions.noEmail')}
            >
              <Icons.mail aria-hidden='true' />
              <span className='hidden sm:inline'>{t('actions.replyByEmail')}</span>
            </Button>
          )
        ) : null}
        {isVisitor && canManageVisitors && !c.archived_at ? (
          <Button
            variant='outline'
            size='sm'
            className='border-border/50 rounded-full'
            onClick={() => onVisitorStatus(c.resolved_at ? 'open' : 'resolved')}
          >
            <Icons.circleCheck aria-hidden='true' />
            <span className='hidden sm:inline'>
              {c.resolved_at ? t('actions.reopen') : t('actions.resolve')}
            </span>
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className={iconButton}
                aria-label={t('actions.menu')}
              />
            }
          >
            <Icons.ellipsis className='size-4' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='min-w-48'>
            <DropdownMenuItem onClick={onToggleMute}>
              <Icons.bellOff className='mr-2 size-4' aria-hidden='true' />
              {c.muted ? t('actions.unmute') : t('actions.mute')}
            </DropdownMenuItem>
            {isVisitor && canManageVisitors ? (
              <>
                <DropdownMenuSeparator />
                {c.archived_at ? (
                  <DropdownMenuItem onClick={() => onVisitorStatus('open')}>
                    <Icons.archive className='mr-2 size-4' aria-hidden='true' />
                    {t('actions.unarchive')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => onVisitorStatus('archived')}>
                    <Icons.archive className='mr-2 size-4' aria-hidden='true' />
                    {t('actions.archive')}
                  </DropdownMenuItem>
                )}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
