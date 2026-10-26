'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDashboardSession } from '@/lib/auth/session-context';
import { createClient } from '@/lib/supabase/client';
import { minorToMajor, moneyFormat } from '@/features/payments/lib/money';
import { activityQueryOptions } from '../api/queries';
import type { ActivityItem, ActivityKind } from '../api/types';
import { useFormTypeLabel } from './use-labels';
import { useNow } from '../lib/use-now';

const SEEN_KEY = 'lu.activity.seen';

const KIND: Record<ActivityKind, { icon: keyof typeof Icons; href: string }> = {
  submission: { icon: 'inbox', href: '/dashboard/site/requests?view=all' },
  appointment: { icon: 'calendar', href: '/dashboard/site/appointments' },
  waitlist: { icon: 'hourglass', href: '/dashboard/site/waitlist' },
  payment: { icon: 'creditCard', href: '/dashboard/site/payments' },
  review: { icon: 'star', href: '/dashboard/site/reviews' },
  project_request: { icon: 'briefcase', href: '/dashboard/site/project-requests' }
};

function readSeen(websiteId: string): number {
  try {
    return Number(window.localStorage.getItem(`${SEEN_KEY}.${websiteId}`)) || 0;
  } catch {
    return 0;
  }
}

function writeSeen(websiteId: string, at: number) {
  try {
    window.localStorage.setItem(`${SEEN_KEY}.${websiteId}`, String(at));
  } catch {
    // Storage blocked: the dot simply comes back next visit.
  }
}

/** Header bell: the latest real events of the active website. */
export function ActivityBell() {
  const { activeWebsite } = useDashboardSession();
  const websiteId = activeWebsite?.id ?? '';
  const { data = [] } = useQuery({
    ...activityQueryOptions(createClient(), websiteId),
    enabled: !!websiteId,
    retry: false
  });
  const [seen, setSeen] = useState(0);
  const t = useTranslations('insights.activity');
  useEffect(() => setSeen(readSeen(websiteId)), [websiteId]);
  if (!activeWebsite) return null;
  const unread = data.filter((a) => new Date(a.at).getTime() > seen).length;

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open && data[0]) {
          const latest = new Date(data[0].at).getTime();
          writeSeen(websiteId, latest);
          setSeen(latest);
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            className='relative'
            aria-label={t('label', { count: unread })}
          />
        }
      >
        <Icons.notification className='size-5' />
        {unread > 0 && (
          <span className='bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums'>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align='end' className='w-80 p-0'>
        <div className='border-b px-3 py-2'>
          <p className='text-sm font-medium'>{t('title')}</p>
          <p className='text-muted-foreground text-xs'>
            {activeWebsite.primaryDomain ?? activeWebsite.name}
          </p>
        </div>
        {data.length === 0 ? (
          <p className='text-muted-foreground px-3 py-6 text-center text-sm'>{t('empty')}</p>
        ) : (
          <ul className='max-h-96 overflow-y-auto py-1'>
            {data.map((item) => (
              <ActivityRow
                key={`${item.kind}-${item.id}`}
                item={item}
                unread={new Date(item.at).getTime() > seen}
              />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ActivityRow({ item, unread }: { item: ActivityItem; unread: boolean }) {
  const t = useTranslations('insights.activity');
  const now = useNow();
  const format = useFormatter();
  const typeLabel = useFormTypeLabel();
  const meta = KIND[item.kind] ?? KIND.submission;
  const Icon = Icons[meta.icon];
  const text = (() => {
    switch (item.kind) {
      case 'submission':
        return t('submission', { form: typeLabel(item.label), name: item.title || '' });
      case 'appointment':
        return t('appointment', { name: item.title || '', service: item.label });
      case 'waitlist':
        return t('waitlist', { name: item.title || '' });
      case 'payment':
        return t('payment', {
          amount:
            item.amount !== undefined && item.currency
              ? format.number(minorToMajor(item.amount, item.currency), moneyFormat(item.currency))
              : '',
          offer: item.label,
          status: item.status ?? ''
        });
      case 'review':
        return t('review', { name: item.title || '', rating: item.rating ?? 0 });
      case 'project_request':
        return t('projectRequest', { name: item.title || item.label, score: item.rating ?? 0 });
      default:
        return item.label;
    }
  })();
  return (
    <li>
      <Link href={meta.href} className='hover:bg-muted/50 flex gap-3 px-3 py-2 text-sm'>
        <Icon className='text-muted-foreground mt-0.5 size-4 shrink-0' aria-hidden />
        <span className='min-w-0 flex-1'>
          <span className='line-clamp-2'>{text}</span>
          <span className='text-muted-foreground text-xs'>
            {format.relativeTime(new Date(item.at), now)}
          </span>
        </span>
        {unread && (
          <span className='bg-primary mt-1.5 size-2 shrink-0 rounded-full' aria-label={t('new')} />
        )}
      </Link>
    </li>
  );
}
