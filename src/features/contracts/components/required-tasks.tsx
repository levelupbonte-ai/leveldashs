'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboardSession } from '@/lib/auth/session-context';
import type { RequiredTask } from '@/lib/auth/types';

const HREF: Record<RequiredTask, string> = {
  profile: '/dashboard/profile',
  logo: '/dashboard/profile',
  mfa: '/dashboard/profile#security'
};

/**
 * "Tasks to complete": the setup checklist steps LevelUp made blocking for this
 * organization and that the user has not finished yet. Calm on purpose.
 */
export function RequiredTasks() {
  const t = useTranslations('contract.tasks');
  const ts = useTranslations('setup.tasks');
  const { access } = useDashboardSession();
  if (access.pendingTasks.length === 0) return null;

  return (
    <Card className='gap-4'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Icons.listCheck className='text-primary size-5' aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='divide-y rounded-lg border'>
          {access.pendingTasks.map((task) => (
            <li key={task} className='flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4'>
              <div className='flex min-w-0 flex-1 items-start gap-3'>
                <Icons.circleDashed
                  className='text-muted-foreground mt-0.5 size-5 shrink-0'
                  aria-label={t('todo')}
                />
                <div className='min-w-0'>
                  <p className='text-sm font-medium'>{ts(`${task}.title`)}</p>
                  <p className='text-muted-foreground text-sm'>{ts(`${task}.description`)}</p>
                </div>
              </div>
              <Link
                href={HREF[task]}
                className={buttonVariants({
                  size: 'sm',
                  variant: 'outline',
                  className: 'ms-8 w-fit sm:ms-0'
                })}
              >
                {ts(`${task}.action`)}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
