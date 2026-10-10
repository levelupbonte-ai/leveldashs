'use client';

import { Icons } from '@/components/icons';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { useSuspenseQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { overviewQueryOptions } from '../api/queries';
import { useSiteScope } from './use-site-scope';

export function SiteOverviewCards() {
  const scope = useSiteScope();
  const { data } = useSuspenseQuery(overviewQueryOptions(createClient(), scope.websiteId));
  const f = scope.website.features;
  const t = useTranslations('site.overview');

  const cards = [
    f.includes('bookings') && {
      href: '/dashboard/site/appointments',
      label: t('pendingAppointments'),
      value: data.pendingAppointments,
      hint: t('upcoming', { count: data.upcomingAppointments }),
      icon: Icons.calendar
    },
    f.includes('waitlist') && {
      href: '/dashboard/site/waitlist',
      label: t('waiting'),
      value: data.waiting,
      hint: t('waitingHint'),
      icon: Icons.hourglass
    },
    {
      href: '/dashboard/site/requests',
      label: t('newRequests'),
      value: data.newRequests,
      hint: t('newRequestsHint'),
      icon: Icons.inbox
    },
    {
      href: '/dashboard/site/media',
      label: t('files'),
      value: data.media,
      hint: t('filesHint'),
      icon: Icons.photo
    }
  ].filter(Boolean) as {
    href: string;
    label: string;
    value: number;
    hint: string;
    icon: typeof Icons.calendar;
  }[];

  return (
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
      {cards.map((c) => (
        <Link key={c.href} href={c.href} className='group' aria-label={`${c.label}: ${c.value}`}>
          <Card className='group-hover:bg-muted/40 h-full transition'>
            <CardHeader>
              <CardDescription className='flex items-center gap-2'>
                <c.icon className='size-4' /> {c.label}
              </CardDescription>
              <CardTitle className='text-3xl tabular-nums'>{c.value}</CardTitle>
              <CardDescription className='text-xs'>{c.hint}</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}
