'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { accessRequestsQueryOptions } from '../api/queries';
import type { AccessRequest } from '../api/types';
import { AccessReviewDialog } from './access-review-dialog';

const STATUS_VARIANT: Record<AccessRequest['status'], 'default' | 'secondary' | 'outline'> = {
  pending: 'default',
  approved: 'secondary',
  rejected: 'outline'
};

/** Approved into an organization that has no website (the "moni" case). */
export const needsFix = (r: AccessRequest) =>
  r.status === 'approved' && !!r.organization_id && r.organization_websites === 0;

/**
 * LevelUp staff: who asked for dashboard access. Nothing is approved in one
 * click: "Review" opens the explicit decision dialog (connect to an existing
 * site, or create a new client), "Fix" reconnects an account that was approved
 * into an empty organization.
 */
export function AccessRequests() {
  const t = useTranslations('admin.accessRequests');
  const format = useFormatter();
  const { data } = useSuspenseQuery(accessRequestsQueryOptions(createClient()));
  const [open, setOpen] = useState<{ userId: string; fix: boolean } | null>(null);
  const pending = data.filter((r) => r.status === 'pending').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {t('title')} {pending > 0 && <Badge>{pending}</Badge>}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {data.length === 0 && <p className='text-muted-foreground text-sm'>{t('empty')}</p>}
        {data.map((r) => (
          <div
            key={r.user_id}
            className='flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between'
          >
            <div className='min-w-0 space-y-1 text-sm'>
              <p className='font-medium'>
                {r.business_name}{' '}
                <Badge variant={STATUS_VARIANT[r.status]} className='ml-1 align-middle'>
                  {t(`status.${r.status}`)}
                </Badge>
              </p>
              <p className='text-muted-foreground break-all'>
                {r.full_name ? `${r.full_name} · ` : ''}
                {r.email}
                {r.phone ? ` · ${r.phone}` : ''}{' '}
                {!r.email_confirmed && (
                  <Badge variant='outline' className='text-amber-700 dark:text-amber-300'>
                    {t('emailUnconfirmed')}
                  </Badge>
                )}
              </p>
              {r.website && <p className='text-muted-foreground truncate'>{r.website}</p>}
              {r.status === 'approved' && r.organization_name && (
                <p className='text-muted-foreground'>
                  {t('connectedTo', {
                    place: r.website_domain ?? r.website_name ?? r.organization_name
                  })}
                </p>
              )}
              {needsFix(r) && (
                <p className='flex items-center gap-1 text-amber-700 dark:text-amber-300'>
                  <Icons.warning className='size-4' aria-hidden />
                  {t('fixHint', { name: r.organization_name ?? '' })}
                </p>
              )}
              <p className='text-muted-foreground text-xs'>
                {format.dateTime(new Date(r.created_at), {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                })}
              </p>
            </div>
            {r.status !== 'approved' && (
              <Button size='sm' onClick={() => setOpen({ userId: r.user_id, fix: false })}>
                {t('review')}
              </Button>
            )}
            {needsFix(r) && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => setOpen({ userId: r.user_id, fix: true })}
              >
                <Icons.adjustments className='size-4' aria-hidden />
                {t('fix')}
              </Button>
            )}
          </div>
        ))}
      </CardContent>
      <AccessReviewDialog
        userId={open?.userId ?? null}
        fix={open?.fix}
        onOpenChange={(v) => !v && setOpen(null)}
      />
    </Card>
  );
}
