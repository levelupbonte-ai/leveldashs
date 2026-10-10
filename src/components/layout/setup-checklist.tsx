'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { Icons } from '@/components/icons';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useDashboardSession } from '@/lib/auth/session-context';
import { hasRole } from '@/lib/auth/types';
import { cn } from '@/lib/utils';

type TaskId = 'profile' | 'logo' | 'mfa';

interface Task {
  id: TaskId;
  done: boolean;
  href: string;
  /** Optional steps can be hidden; required ones (MFA for managers) stay until done. */
  dismissible: boolean;
}

// Dismissed optional steps: a per-browser convenience, nothing depends on it.
const STORAGE_PREFIX = 'lu_setup_dismissed:';
const listeners = new Set<() => void>();

function readDismissed(userId: string): string {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + userId) ?? '';
  } catch {
    return '';
  }
}

function dismiss(userId: string, id: TaskId) {
  try {
    const current = new Set(readDismissed(userId).split(',').filter(Boolean));
    current.add(id);
    window.localStorage.setItem(STORAGE_PREFIX + userId, [...current].join(','));
  } catch {
    // Storage blocked: the step simply stays visible.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * "Finish setting up your account": a calm checklist on the dashboard home
 * (profile, organization logo, two-step verification). Two-step verification
 * cannot be dismissed for accounts that manage a team (owners, admins, LevelUp
 * staff) until it is turned on.
 */
export function SetupChecklist() {
  const t = useTranslations('setup');
  const pathname = usePathname();
  const { user, activeOrg, isPlatformAdmin, mfa } = useDashboardSession();
  const dismissedRaw = useSyncExternalStore(
    subscribe,
    () => readDismissed(user.id),
    () => ''
  );
  if (pathname !== '/dashboard/site') return null;

  const dismissed = new Set(dismissedRaw.split(',').filter(Boolean));
  const canBrand = !!activeOrg && (isPlatformAdmin || hasRole(activeOrg.role, 'admin'));
  const hasName = !!user.fullName && user.fullName !== user.email.split('@')[0];

  const tasks: Task[] = [
    { id: 'profile', done: hasName, href: '/dashboard/profile', dismissible: true },
    ...(canBrand
      ? [
          {
            id: 'logo' as const,
            done: !!activeOrg?.logoUrl,
            href: '/dashboard/profile',
            dismissible: true
          }
        ]
      : []),
    {
      id: 'mfa',
      done: mfa.enabled,
      href: '/dashboard/profile#security',
      dismissible: !mfa.required
    }
  ];
  const visible = tasks.filter((task) => task.done || !task.dismissible || !dismissed.has(task.id));
  const doneCount = visible.filter((task) => task.done).length;
  if (visible.every((task) => task.done)) return null;

  return (
    <div className='px-4 pt-4 md:px-6'>
      <Card className='gap-4 py-5'>
        <CardHeader className='px-5'>
          <div className='flex flex-wrap items-end justify-between gap-x-4 gap-y-1'>
            <div className='space-y-1'>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Icons.listCheck className='text-primary size-5' aria-hidden />
                {t('title')}
              </CardTitle>
              <CardDescription>{t('description')}</CardDescription>
            </div>
            <p className='text-muted-foreground text-sm tabular-nums'>
              {t('progress', { done: doneCount, total: visible.length })}
            </p>
          </div>
          <Progress
            value={(doneCount / visible.length) * 100}
            aria-label={t('progress', { done: doneCount, total: visible.length })}
            className='mt-3'
          />
        </CardHeader>
        <CardContent className='px-5'>
          <ul className='divide-y rounded-lg border'>
            {visible.map((task) => (
              <li
                key={task.id}
                className='flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4'
              >
                <div className='flex min-w-0 flex-1 items-start gap-3'>
                  {task.done ? (
                    <Icons.circleCheck
                      className='text-primary mt-0.5 size-5 shrink-0'
                      aria-label={t('done')}
                    />
                  ) : (
                    <Icons.circleDashed
                      className='text-muted-foreground mt-0.5 size-5 shrink-0'
                      aria-label={t('todo')}
                    />
                  )}
                  <div className='min-w-0'>
                    <p
                      className={cn(
                        'text-sm font-medium',
                        task.done && 'text-muted-foreground line-through decoration-1'
                      )}
                    >
                      {t(`tasks.${task.id}.title`)}
                    </p>
                    {!task.done && (
                      <p className='text-muted-foreground text-sm'>
                        {t(`tasks.${task.id}.description`)}
                      </p>
                    )}
                  </div>
                </div>
                {!task.done && (
                  <div className='flex shrink-0 items-center gap-1 ps-8 sm:ps-0'>
                    <Link
                      href={task.href}
                      className={buttonVariants({
                        size: 'sm',
                        variant: task.id === 'mfa' ? 'default' : 'outline'
                      })}
                    >
                      {t(`tasks.${task.id}.action`)}
                    </Link>
                    {task.dismissible && (
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        className='size-8'
                        aria-label={t('dismiss')}
                        title={t('dismiss')}
                        onClick={() => dismiss(user.id, task.id)}
                      >
                        <Icons.close className='size-4' aria-hidden />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
