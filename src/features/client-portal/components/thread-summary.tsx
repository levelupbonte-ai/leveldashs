'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalKeys } from '../api/queries';
import { getPortalThreadSummary } from '../api/service';

/**
 * "AI summary" at the top of a member's conversation: what they want, the
 * situation, urgency and the next step. Recomputed only when the member wrote
 * since the last summary (the key follows their latest message).
 */
export function ThreadSummary({
  customerId,
  lastMemberMessage,
  compact
}: {
  customerId: string;
  /** Id of the member's latest message (null: nothing to summarize yet). */
  lastMemberMessage: string | null;
  compact?: boolean;
}) {
  const t = useTranslations('clientPortal.thread.ai');
  const scope = useSiteScope();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const key = portalKeys.summary(scope.websiteId, customerId, lastMemberMessage ?? 'none');
  const { data, isPending, isError } = useQuery({
    queryKey: key,
    queryFn: () => getPortalThreadSummary(customerId),
    enabled: !!lastMemberMessage,
    staleTime: Infinity,
    retry: 1
  });

  if (!lastMemberMessage || isError) return null;
  if (isPending) return <Skeleton className='h-14 w-full rounded-xl' aria-label={t('loading')} />;
  const s = data?.summary;
  if (!s) return null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      queryClient.setQueryData(key, await getPortalThreadSummary(customerId, true));
      void queryClient.invalidateQueries({ queryKey: portalKeys.inbox(scope.websiteId) });
    } catch {
      // keep the current summary
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className='bg-primary/5 border-primary/20 rounded-xl border px-3 py-2.5 text-sm'>
      <div className='flex items-start gap-2'>
        <Icons.sparkles className='text-primary mt-0.5 size-4 shrink-0' aria-hidden />
        <div className='min-w-0 flex-1'>
          <p className='text-muted-foreground text-[11px] font-medium tracking-wide uppercase'>
            {t('title')}
          </p>
          <p className='font-medium'>{s.need}</p>
        </div>
        {s.urgency === 'high' && <Badge variant='destructive'>{t('urgent')}</Badge>}
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-7 shrink-0'
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? t('hide') : t('show')}
        >
          <Icons.chevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </Button>
      </div>
      {open && !compact && (
        <div className='mt-1.5 space-y-1.5 pl-6'>
          <p className='text-muted-foreground'>{s.summary}</p>
          {s.next && (
            <p>
              <span className='font-medium'>{t('next')} </span>
              {s.next}
            </p>
          )}
          <div className='flex items-center gap-2'>
            <span className='text-muted-foreground text-[11px]'>{t('note')}</span>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='ml-auto h-6 px-2 text-xs'
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <Icons.refresh className={cn('size-3', refreshing && 'animate-spin')} aria-hidden />
              {t('refresh')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
