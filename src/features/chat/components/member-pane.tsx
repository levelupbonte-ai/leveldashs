'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { PortalInboxEntry } from '@/features/client-portal/api/types';
import { PortalThread } from '@/features/client-portal/components/thread-sheet';

/**
 * A client-portal member's conversation inside the chat page (Black Pater…):
 * the same thread as in the portal page, so the team answers everything in
 * one place. The member sees the reply in their space and gets an e-mail.
 */
export function MemberPane({
  member,
  keyboard,
  onBack
}: {
  member: PortalInboxEntry;
  keyboard: boolean;
  onBack: () => void;
}) {
  const t = useTranslations('chat.member');
  return (
    <div className='border-border/40 bg-background/80 flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-2xl border pt-3 lg:rounded-3xl'>
      <div className='flex items-center gap-2 px-3'>
        <Button
          type='button'
          size='icon'
          variant='ghost'
          className='size-8 shrink-0 lg:hidden'
          onClick={onBack}
          aria-label={t('back')}
        >
          <Icons.chevronLeft aria-hidden />
        </Button>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-semibold'>{member.name || member.email}</p>
          <p className='text-muted-foreground truncate text-xs'>{t('subtitle')}</p>
        </div>
        <Button
          size='sm'
          variant='outline'
          className='shrink-0 rounded-full'
          nativeButton={false}
          render={
            <Link href='/dashboard/site/client-portal?tab=customers' aria-label={t('profile')} />
          }
        >
          <Icons.user aria-hidden />
          <span className='hidden sm:inline'>{t('profile')}</span>
        </Button>
      </div>
      <PortalThread key={member.id} customer={member} keyboard={keyboard} />
    </div>
  );
}
