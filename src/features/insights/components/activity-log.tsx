'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Suspense, useState, useTransition } from 'react';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { activityLogQueryOptions } from '../api/queries';
import { ACTIVITY_LOG_PER_PAGE } from '../api/service';
import type { ActivityLogEntry } from '../api/types';
import { Pager } from './table-tools';

/** Activity log of the site: owners and admins see who in the team changed what. */
export function ActivityLog() {
  const t = useTranslations('insights.log');
  const { canAdmin } = useSiteScope();
  if (!canAdmin) {
    return (
      <Alert>
        <Icons.lock className='size-4' />
        <AlertDescription>{t('adminsOnly')}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Suspense fallback={<Skeleton className='h-96 w-full' />}>
      <ActivityLogList />
    </Suspense>
  );
}

function ActivityLogList() {
  const t = useTranslations('insights.log');
  const format = useFormatter();
  const { websiteId } = useSiteScope();
  const [db] = useState(createClient);
  const [page, setPage] = useState(1);
  const [pending, startTransition] = useTransition();
  const { data } = useSuspenseQuery(activityLogQueryOptions(db, websiteId, page));

  if (data.rows.length === 0) {
    return <p className='text-muted-foreground text-sm'>{t('empty')}</p>;
  }
  return (
    <div className='grid gap-4'>
      <ul
        className={pending ? 'divide-y rounded-lg border opacity-60' : 'divide-y rounded-lg border'}
      >
        {data.rows.map((row) => (
          <li
            key={row.id}
            className='flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm'
          >
            <span>
              <span className='font-medium'>{describe(t, row)}</span>
              {row.label && <span className='text-muted-foreground'> · {row.label}</span>}
            </span>
            <span className='text-muted-foreground text-xs tabular-nums'>
              {row.actor ?? t('system')} ·{' '}
              {format.dateTime(new Date(row.created_at), {
                dateStyle: 'medium',
                timeStyle: 'short'
              })}
            </span>
          </li>
        ))}
      </ul>
      <Pager
        page={page}
        perPage={ACTIVITY_LOG_PER_PAGE}
        total={data.total}
        onPage={(next) => startTransition(() => setPage(next))}
      />
    </div>
  );
}

type LogT = ReturnType<typeof useTranslations<'insights.log'>>;

/** "Updated · Services", "Campaign started", or the raw action if unknown. */
function describe(t: LogT, row: ActivityLogEntry): string {
  if (row.action.startsWith('content.')) {
    const verb = row.action.slice('content.'.length);
    const what =
      row.area && t.has(`areas.${row.area}` as 'areas.media')
        ? t(`areas.${row.area}` as 'areas.media')
        : t('areas.other');
    return t.has(`content.${verb}` as 'content.updated')
      ? t(`content.${verb}` as 'content.updated', { what })
      : what;
  }
  const key = `actions.${row.action.replace(/\./g, '_')}` as 'actions.api_key_created';
  return t.has(key) ? t(key) : row.action;
}
