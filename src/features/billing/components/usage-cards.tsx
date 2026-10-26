'use client';
import { useFormatter, useTranslations } from 'next-intl';
import type { ComponentType } from 'react';
import { Icons } from '@/components/icons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { BillingUsage, LimitKey, UsageMeter } from '../api/types';
import { meterPercent, meterState, storageParts } from '../lib/format';

const LIMIT_ICON: Record<LimitKey, ComponentType<{ className?: string }>> = {
  team_members: Icons.teams,
  assistant_requests_month: Icons.starMark,
  media_mb: Icons.storage,
  websites: Icons.world
};

/** One meter per plan limit: "Team members 2 / 3", near-limit and at-limit states. */
export function LimitMeters({ usage }: { usage: UsageMeter[] }) {
  const t = useTranslations('billing.limits');
  const format = useFormatter();
  const value = (key: LimitKey, n: number) =>
    key === 'media_mb'
      ? (() => {
          const s = storageParts(n * 1048576);
          return `${format.number(s.value)} ${s.unit}`;
        })()
      : format.number(n);

  return (
    <Card className='h-full'>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {usage.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('none')}</p>
        ) : (
          <ul className='space-y-5'>
            {usage.map((m) => {
              // Websites are set up by LevelUp: using all of them is normal, only more is flagged.
              const state =
                m.key === 'websites' && m.limit !== null && m.used <= m.limit
                  ? 'ok'
                  : meterState(m.used, m.limit);
              const percent = meterPercent(m.used, m.limit);
              const Icon = LIMIT_ICON[m.key];
              return (
                <li key={m.key} className='space-y-2'>
                  <div className='flex items-center justify-between gap-3 text-sm'>
                    <span className='flex min-w-0 items-center gap-2 font-medium'>
                      <Icon className='text-muted-foreground size-4 shrink-0' aria-hidden />
                      <span className='truncate'>{t(m.key)}</span>
                    </span>
                    <span className='shrink-0 tabular-nums'>
                      {m.limit === null
                        ? `${value(m.key, m.used)} · ${t('unlimited')}`
                        : t('of', {
                            used: value(m.key, m.used),
                            limit: value(m.key, m.limit)
                          })}
                    </span>
                  </div>
                  {m.limit !== null && (
                    <div
                      role='progressbar'
                      aria-label={t(m.key)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      className='bg-muted h-2 overflow-hidden rounded-full'
                    >
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          state === 'reached'
                            ? 'bg-destructive'
                            : state === 'near'
                              ? 'bg-amber-500'
                              : 'bg-primary'
                        )}
                        style={{
                          width: `${Math.max(percent, m.used > 0 ? 2 : 0)}%`
                        }}
                      />
                    </div>
                  )}
                  {state !== 'ok' && (
                    <p
                      className={cn(
                        'flex items-center gap-1 text-xs',
                        state === 'reached'
                          ? 'text-destructive'
                          : 'text-amber-700 dark:text-amber-300'
                      )}
                    >
                      <Icons.alertCircle className='size-3.5' aria-hidden />
                      {state === 'reached' ? t('reached') : t('near')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** This period's real counts (never costs, never providers). */
export function UsagePanel({ usage }: { usage: BillingUsage }) {
  const t = useTranslations('billing.usage');
  const format = useFormatter();
  const storage = storageParts(usage.storage_bytes);
  const tiles: {
    key: string;
    icon: ComponentType<{ className?: string }>;
    label: string;
    value: string;
    hint?: string;
  }[] = [
    {
      key: 'storage',
      icon: Icons.storage,
      label: t('storage'),
      value: `${format.number(storage.value)} ${storage.unit}`,
      hint: t('files', { count: usage.media_files })
    },
    {
      key: 'messages',
      icon: Icons.chat,
      label: t('messages'),
      value: format.number(usage.chat_messages_month)
    },
    {
      key: 'assistant',
      icon: Icons.starMark,
      label: t('assistant'),
      value: format.number(usage.assistant_requests_month)
    },
    {
      key: 'team',
      icon: Icons.teams,
      label: t('team'),
      value: format.number(usage.team_members),
      hint: t('pendingInvites', { count: usage.pending_invitations })
    },
    {
      key: 'websites',
      icon: Icons.world,
      label: t('websites'),
      value: format.number(usage.websites)
    }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('description', {
            date: format.dateTime(new Date(usage.period_start), {
              dateStyle: 'long',
              timeZone: 'UTC'
            })
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5'>
          {tiles.map(({ key, icon: Icon, label, value, hint }) => (
            <div key={key} className='bg-muted/30 min-w-0 rounded-lg border p-3'>
              <dt className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                <Icon className='size-3.5 shrink-0' aria-hidden />
                <span className='truncate'>{label}</span>
              </dt>
              <dd className='mt-1 text-xl font-semibold tabular-nums'>{value}</dd>
              {hint && <dd className='text-muted-foreground truncate text-xs'>{hint}</dd>}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
