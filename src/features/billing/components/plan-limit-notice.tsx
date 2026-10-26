'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import type { PlanLimitInfo } from '@/lib/plan-limit';
import { cn } from '@/lib/utils';

/**
 * Calm inline notice when an action hits the organization's plan limit
 * ("Your plan allows N … Upgrade to do more."), with a link to Billing.
 */
export function PlanLimitNotice({ info, className }: { info: PlanLimitInfo; className?: string }) {
  const t = useTranslations('billing.limitNotice');

  return (
    <div
      role='status'
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-center',
        className
      )}
    >
      <div className='flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300'>
        <Icons.pro className='size-4' aria-hidden />
      </div>
      <div className='min-w-0 flex-1 space-y-0.5'>
        <p className='text-sm font-medium'>{t('title')}</p>
        <p className='text-muted-foreground text-sm'>
          {t(info.key, { limit: info.limit })} {t('upgrade')}
        </p>
      </div>
      <Link
        href='/dashboard/billing#plans'
        className={buttonVariants({ size: 'sm', className: 'shrink-0' })}
      >
        {t('action')}
      </Link>
    </div>
  );
}
