'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { useNow } from '@/features/insights/lib/use-now';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { developerActivityQueryOptions } from '../api/queries';
import { AUDIT_ACTIONS, type AuditAction, type DeveloperActivity } from '../api/types';

const PAYMENT_STATUSES = ['paid', 'pending', 'failed', 'refunded', 'expired'] as const;

function ActivityIcon({ item }: { item: DeveloperActivity }) {
  const base = 'flex size-8 shrink-0 items-center justify-center rounded-full border';
  if (item.kind === 'payment_event') {
    return (
      <span className={cn(base, 'text-sky-700 dark:text-sky-300')}>
        <Icons.creditCard className='size-4' aria-hidden />
      </span>
    );
  }
  if (item.action === 'api_key.revoked') {
    return (
      <span className={cn(base, 'text-destructive')}>
        <Icons.ban className='size-4' aria-hidden />
      </span>
    );
  }
  if (item.action === 'api_key.created') {
    return (
      <span className={cn(base, 'text-emerald-700 dark:text-emerald-300')}>
        <Icons.key className='size-4' aria-hidden />
      </span>
    );
  }
  return (
    <span className={cn(base, 'text-muted-foreground')}>
      <Icons.activity className='size-4' aria-hidden />
    </span>
  );
}

/** Developers → Activity: key changes and exports (audit log) + payment events received. */
export function DeveloperActivityCard() {
  const scope = useSiteScope();
  const { data: items } = useSuspenseQuery(
    developerActivityQueryOptions(createClient(), scope.websiteId)
  );
  const t = useTranslations('site.developers.activity');
  const format = useFormatter();
  const now = useNow();

  const describe = (item: DeveloperActivity) => {
    if (item.kind === 'payment_event') {
      const status = (PAYMENT_STATUSES as readonly string[]).includes(item.status)
        ? t(`status.${item.status as (typeof PAYMENT_STATUSES)[number]}`)
        : item.status;
      return item.applied ? t('eventApplied', { status }) : t('eventIgnored', { status });
    }
    const actor = item.actor ?? t('someone');
    const action = (AUDIT_ACTIONS as readonly string[]).includes(item.action)
      ? (item.action as AuditAction)
      : null;
    if (!action) return t('other', { actor });
    return t(`actions.${action.replace('.', '_') as 'api_key_created'}`, {
      actor,
      key: item.keyName ?? ''
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <Empty className='border'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Icons.activity aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{t('empty')}</EmptyTitle>
              <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className='space-y-4'>
            {items.map((item) => (
              <li key={item.id} className='flex gap-3'>
                <ActivityIcon item={item} />
                <div className='min-w-0 flex-1'>
                  <p className='text-sm'>{describe(item)}</p>
                  <p className='text-muted-foreground flex flex-wrap gap-x-2 text-xs'>
                    <time
                      dateTime={item.at}
                      title={format.dateTime(new Date(item.at), {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                      })}
                    >
                      {format.relativeTime(new Date(item.at), now)}
                    </time>
                    {item.kind === 'audit' && item.keyHint && (
                      <span className='font-mono'>{item.keyHint}</span>
                    )}
                    {item.kind === 'payment_event' && (
                      <span className='truncate font-mono'>{item.eventId}</span>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
