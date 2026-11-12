'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { useErrorMessage } from '@/hooks/use-error-message';
import { createClient } from '@/lib/supabase/client';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { campaignsListQueryOptions, engageKeys } from '../api/queries';
import { setCampaignStatus } from '../api/service';
import type { Campaign, CampaignStatus } from '../api/types';
import { CampaignSheet } from './campaign-sheet';

/**
 * Bars, pop-ups and inline cards shown on the website by the LevelUp tag.
 * Changes reach visitors within a minute (cached site bundle).
 */
export function CampaignsView() {
  const scope = useSiteScope();
  const t = useTranslations('engage.campaigns');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(campaignsListQueryOptions(createClient(), scope.websiteId));
  const [editing, setEditing] = useState<Campaign | null | undefined>(undefined);
  const [archive, setArchive] = useState<Campaign | null>(null);

  const status = useMutation({
    mutationFn: ({ id, next }: { id: string; next: CampaignStatus }) =>
      setCampaignStatus(createClient(), id, next),
    onSuccess: (_d, v) => {
      toast.success(t(`statusSaved.${v.next}`));
      void queryClient.invalidateQueries({ queryKey: engageKeys.campaigns(scope.websiteId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setArchive(null)
  });

  const when = (c: Campaign) => {
    const d = (iso: string) =>
      format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
    if (c.starts_at && c.ends_at)
      return t('schedule.between', { start: d(c.starts_at), end: d(c.ends_at) });
    if (c.ends_at) return t('schedule.until', { end: d(c.ends_at) });
    if (c.starts_at) return t('schedule.from', { start: d(c.starts_at) });
    return t('schedule.always');
  };

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground max-w-2xl text-sm'>{t('intro')}</p>
        {scope.canEdit && (
          <Button onClick={() => setEditing(null)}>
            <Icons.add aria-hidden />
            {t('new')}
          </Button>
        )}
      </div>

      {data.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Icons.speakerphone />
            </EmptyMedia>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className='grid gap-3 lg:grid-cols-2'>
          {data.map((c) => {
            const ctr = c.stats.views
              ? Math.round((c.stats.clicks / c.stats.views) * 1000) / 10
              : 0;
            const title =
              c.content.fr?.title ||
              c.content.en?.title ||
              c.content.fr?.text ||
              c.content.en?.text;
            return (
              <li key={c.id}>
                <Card className='h-full gap-3 py-4'>
                  <CardHeader className='px-4'>
                    <div className='flex items-start justify-between gap-2'>
                      <div className='min-w-0'>
                        <CardTitle className='truncate text-base'>{c.name}</CardTitle>
                        <CardDescription className='truncate'>{title}</CardDescription>
                      </div>
                      <div className='flex shrink-0 gap-1'>
                        <Badge variant='outline'>{t(`editor.kinds.${c.kind}`)}</Badge>
                        <Badge variant={c.status === 'active' ? 'default' : 'secondary'}>
                          {t(`status.${c.status}`)}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-3 px-4 text-sm'>
                    <p className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                      <Icons.calendar className='size-3.5' aria-hidden />
                      {when(c)}
                      {c.pages.length > 0 && ` · ${t('onPages', { count: c.pages.length })}`}
                      {c.kind === 'slot' && c.slot && ` · data-lu-campaign="${c.slot}"`}
                    </p>
                    <dl className='grid grid-cols-3 gap-2 text-center'>
                      {(
                        [
                          ['views', c.stats.views],
                          ['clicks', c.stats.clicks],
                          ['ctr', `${ctr} %`]
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k} className='bg-muted/50 rounded-md py-2'>
                          <dt className='text-muted-foreground text-xs'>{t(`stats.${k}`)}</dt>
                          <dd className='font-semibold tabular-nums'>{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className='text-muted-foreground text-xs'>{t('stats.period')}</p>
                    {scope.canEdit && (
                      <div className='flex flex-wrap gap-2'>
                        <Button size='sm' variant='outline' onClick={() => setEditing(c)}>
                          <Icons.edit aria-hidden />
                          {t('edit')}
                        </Button>
                        {c.status === 'active' ? (
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={status.isPending}
                            onClick={() => status.mutate({ id: c.id, next: 'paused' })}
                          >
                            {t('pause')}
                          </Button>
                        ) : (
                          <Button
                            size='sm'
                            disabled={status.isPending}
                            onClick={() => status.mutate({ id: c.id, next: 'active' })}
                          >
                            {t('activate')}
                          </Button>
                        )}
                        <Button size='sm' variant='ghost' onClick={() => setArchive(c)}>
                          <Icons.archive aria-hidden />
                          {t('archive')}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Card className='py-4'>
        <CardContent className='space-y-2 px-4 text-sm'>
          <p className='font-medium'>{t('how.title')}</p>
          <p className='text-muted-foreground'>{t('how.text')}</p>
          <code className='bg-muted block overflow-x-auto rounded-md px-3 py-2 text-xs'>
            {'<div data-lu-campaign="prix"></div>'}
          </code>
        </CardContent>
      </Card>

      <CampaignSheet
        open={editing !== undefined}
        campaign={editing ?? null}
        onOpenChange={(open) => !open && setEditing(undefined)}
      />
      <AlertDialog open={!!archive} onOpenChange={(open) => !open && setArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('archiveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('archiveDescription', { name: archive?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('editor.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={status.isPending}
              onClick={() => archive && status.mutate({ id: archive.id, next: 'archived' })}
            >
              {t('archive')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
