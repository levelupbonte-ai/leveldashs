'use client';

import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '../api/types';
import { useChatFormat } from '../hooks/use-chat-format';
import type { MessageGroup } from '../lib/grouping';
import { initials } from '../lib/message-text';
import { MessageBody } from './message-body';

interface MessageGroupViewProps {
  group: MessageGroup;
  canReply: boolean;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onRetry: (message: ChatMessage) => void;
}

/** Consecutive messages of one sender: one avatar and name, then the bubbles. */
export function MessageGroupView({
  group,
  canReply,
  onReply,
  onEdit,
  onDelete,
  onRetry
}: MessageGroupViewProps) {
  const t = useTranslations('chat.message');
  const { time } = useChatFormat();
  const first = group.messages[0];
  const mine = group.mine;
  const name = mine ? t('you') : first.sender_name || t('visitor');

  return (
    <div className={cn('flex gap-2 sm:gap-3', mine && 'flex-row-reverse')}>
      {!mine ? (
        <Avatar className='border-border/40 mt-5 h-8 w-8 shrink-0 rounded-xl border'>
          {first.sender_avatar ? <AvatarImage src={first.sender_avatar} alt='' /> : null}
          <AvatarFallback
            className={cn(
              'rounded-xl text-[0.7rem] font-medium',
              first.kind === 'visitor'
                ? 'bg-muted text-foreground/70'
                : 'bg-primary/15 text-primary'
            )}
          >
            {initials(first.sender_name)}
          </AvatarFallback>
        </Avatar>
      ) : null}
      <div
        className={cn(
          'flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[75%]',
          mine && 'items-end'
        )}
      >
        <p
          className={cn(
            'text-muted-foreground flex items-center gap-1.5 px-1 text-[0.7rem]',
            mine && 'flex-row-reverse'
          )}
        >
          <span className='text-foreground/80 font-medium'>{name}</span>
          {first.kind === 'note' ? (
            <span className='rounded-full bg-amber-500/15 px-1.5 py-px text-[0.6rem] font-semibold text-amber-700 dark:text-amber-300'>
              {t('note')}
            </span>
          ) : first.kind === 'visitor' ? (
            <span className='bg-muted rounded-full px-1.5 py-px text-[0.6rem] font-semibold'>
              {t('visitor')}
            </span>
          ) : null}
          <time dateTime={first.created_at} suppressHydrationWarning>
            {time(first.created_at)}
          </time>
        </p>
        {group.messages.map((m) => (
          <Bubble
            key={m.id}
            message={m}
            mine={mine}
            canReply={canReply}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
            onRetry={onRetry}
          />
        ))}
      </div>
    </div>
  );
}

interface BubbleProps extends Omit<MessageGroupViewProps, 'group'> {
  message: ChatMessage;
  mine: boolean;
}

function Bubble({ message: m, mine, canReply, onReply, onEdit, onDelete, onRetry }: BubbleProps) {
  const t = useTranslations('chat.message');
  const { time } = useChatFormat();
  const reduceMotion = useReducedMotion();
  const deleted = !!m.deleted_at;
  const note = m.kind === 'note';
  const canAct = !deleted && !m.pending;

  return (
    <motion.div
      initial={reduceMotion || !m.pending ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn('group/bubble flex items-center gap-1', mine && 'flex-row-reverse')}
      aria-label={t('at', {
        name: mine ? t('you') : (m.sender_name ?? ''),
        time: time(m.created_at)
      })}
      role='group'
    >
      <div
        className={cn(
          'relative rounded-2xl border px-3 py-2 text-sm leading-relaxed sm:px-4 sm:py-2.5',
          deleted
            ? 'border-border/60 text-muted-foreground bg-transparent italic'
            : note
              ? 'border-amber-500/30 bg-amber-500/10 text-foreground'
              : mine
                ? 'border-primary/40 bg-primary text-primary-foreground'
                : 'bg-muted text-foreground border-transparent',
          m.pending === 'sending' && 'opacity-70',
          m.pending === 'failed' && 'border-destructive/60'
        )}
      >
        {m.reply_to && !deleted ? (
          <div
            className={cn(
              'mb-1.5 border-l-2 pl-2 text-xs',
              mine && !note
                ? 'border-primary-foreground/50 text-primary-foreground/80'
                : 'border-primary/50 text-muted-foreground'
            )}
          >
            <p className='font-medium'>{m.reply_to.sender_name}</p>
            <p className='line-clamp-2'>
              {m.reply_to.deleted ? t('replyDeleted') : m.reply_to.body}
            </p>
          </div>
        ) : null}
        {deleted ? (
          <p>{t('deleted')}</p>
        ) : (
          <MessageBody
            text={m.body ?? ''}
            linkClassName={mine && !note ? 'text-primary-foreground' : 'text-primary'}
          />
        )}
        {m.edited_at && !deleted ? (
          <span
            className={cn(
              'text-[0.65rem]',
              mine && !note ? 'text-primary-foreground/70' : 'text-muted-foreground'
            )}
          >
            {' '}
            ({t('edited')})
          </span>
        ) : null}
        {m.pending === 'sending' ? <span className='sr-only'>{t('sending')}</span> : null}
      </div>

      {m.pending === 'failed' ? (
        <span className='text-destructive flex items-center gap-1 text-[0.7rem]'>
          <Icons.alertCircle className='size-3.5' aria-hidden='true' />
          {t('failed')}
          <button type='button' className='font-medium underline' onClick={() => onRetry(m)}>
            {t('retry')}
          </button>
        </span>
      ) : m.pending === 'sending' ? (
        <Icons.spinner className='text-muted-foreground size-3.5 animate-spin' aria-hidden='true' />
      ) : canAct ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                className='text-muted-foreground opacity-0 transition-opacity group-focus-within/bubble:opacity-100 group-hover/bubble:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 pointer-coarse:opacity-100'
                aria-label={t('actions')}
              />
            }
          >
            <Icons.dots className='size-4' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align={mine ? 'end' : 'start'} className='min-w-40'>
            {canReply ? (
              <DropdownMenuItem onClick={() => onReply(m)}>
                <Icons.reply className='mr-2 size-4' aria-hidden='true' />
                {t('reply')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(m.body ?? '')
                  .then(() => toast.success(t('copied')))
                  .catch(() => undefined)
              }
            >
              <Icons.copy className='mr-2 size-4' aria-hidden='true' />
              {t('copy')}
            </DropdownMenuItem>
            {m.mine ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onEdit(m)}>
                  <Icons.edit className='mr-2 size-4' aria-hidden='true' />
                  {t('edit')}
                </DropdownMenuItem>
                <DropdownMenuItem variant='destructive' onClick={() => onDelete(m)}>
                  <Icons.trash className='mr-2 size-4' aria-hidden='true' />
                  {t('delete')}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </motion.div>
  );
}
