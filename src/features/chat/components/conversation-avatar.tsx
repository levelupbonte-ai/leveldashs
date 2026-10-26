'use client';

import { useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { ChatConversation } from '../api/types';
import { initials } from '../lib/message-text';

/** Display name of a conversation (team, teammate or visitor). */
export function useConversationName() {
  const t = useTranslations('chat');
  return (c: ChatConversation): string => {
    if (c.kind === 'team') return t('teamName');
    if (c.kind === 'direct') return c.peer?.name || t('unknownMember');
    return c.visitor?.name || c.title || c.visitor?.email || t('visitorFallback');
  };
}

interface ConversationAvatarProps {
  conversation: ChatConversation;
  name: string;
  size?: 'sm' | 'lg';
}

export function ConversationAvatar({ conversation, name, size = 'sm' }: ConversationAvatarProps) {
  const box = size === 'lg' ? 'h-10 w-10 sm:h-12 sm:w-12 sm:rounded-3xl' : 'h-10 w-10';
  if (conversation.kind !== 'direct') {
    const Icon = conversation.kind === 'team' ? Icons.teams : Icons.world;
    return (
      <span
        aria-hidden='true'
        className={cn(
          'border-border/40 inline-flex shrink-0 items-center justify-center rounded-2xl border',
          conversation.kind === 'team'
            ? 'bg-primary/15 text-primary'
            : 'bg-muted text-foreground/70',
          box
        )}
      >
        <Icon className='size-5' />
      </span>
    );
  }
  return (
    <Avatar className={cn('border-border/40 bg-background/80 shrink-0 rounded-2xl border', box)}>
      {conversation.peer?.avatar ? <AvatarImage src={conversation.peer.avatar} alt='' /> : null}
      <AvatarFallback className='bg-primary/15 text-primary rounded-2xl text-sm font-medium'>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
