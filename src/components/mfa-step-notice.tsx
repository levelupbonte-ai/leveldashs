'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { mfaChallengeUrl } from '@/lib/auth/mfa';
import { cn } from '@/lib/utils';

/**
 * Calm inline notice for actions the database only allows once the session has
 * passed two-step verification (aal2). Shown instead of an error.
 */
export function MfaStepNotice({ className }: { className?: string }) {
  const t = useTranslations('mfaStep');
  const pathname = usePathname();

  return (
    <div
      role='status'
      className={cn(
        'bg-muted/40 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center',
        className
      )}
    >
      <div className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full'>
        <Icons.shield className='size-4' aria-hidden />
      </div>
      <div className='min-w-0 flex-1 space-y-0.5'>
        <p className='text-sm font-medium'>{t('title')}</p>
        <p className='text-muted-foreground text-sm'>{t('description')}</p>
      </div>
      <Link
        href={mfaChallengeUrl(pathname)}
        className={buttonVariants({ size: 'sm', className: 'shrink-0' })}
      >
        {t('action')}
      </Link>
    </div>
  );
}
