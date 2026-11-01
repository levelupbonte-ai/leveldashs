'use client';
import { useFormatter, useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import type { Campaign, EmailOverview } from '../api/types';
import { CampaignStatusBadge } from './status-badge';

/** Campaigns with their status, recipients, date and real delivery numbers. */
export function CampaignsList({
  campaigns,
  overview,
  onOpen
}: {
  campaigns: Campaign[];
  overview: EmailOverview;
  onOpen: (id: string | null) => void;
}) {
  const t = useTranslations('emailCampaigns.list');
  const tt = useTranslations('emailCampaigns.templates');
  const format = useFormatter();
  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  if (campaigns.length === 0) {
    return (
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.mail />
          </EmptyMedia>
          <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
        </EmptyHeader>
        {overview.can_edit && (
          <EmptyContent>
            <Button onClick={() => onOpen(null)}>
              <Icons.add className='size-4' aria-hidden />
              {t('create')}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }

  const tracking = overview.delivery_tracking;
  return (
    <Card className='overflow-hidden py-0'>
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('subject')}</TableHead>
              <TableHead>{t('status')}</TableHead>
              <TableHead className='text-right'>{t('recipients')}</TableHead>
              <TableHead className='text-right'>{t('sent')}</TableHead>
              {tracking && <TableHead className='text-right'>{t('delivered')}</TableHead>}
              {tracking && <TableHead className='text-right'>{t('bounced')}</TableHead>}
              <TableHead className='text-right'>{t('unsubscribed')}</TableHead>
              <TableHead>{t('date')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((c) => {
              const when =
                c.status === 'scheduled'
                  ? c.scheduled_at
                  : c.status === 'draft'
                    ? c.updated_at
                    : (c.finished_at ?? c.started_at);
              return (
                <TableRow key={c.id} className='cursor-pointer' onClick={() => onOpen(c.id)}>
                  <TableCell className='max-w-[320px]'>
                    <button
                      type='button'
                      className='block w-full truncate text-left font-medium hover:underline'
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(c.id);
                      }}
                    >
                      {c.subject || t('untitled')}
                    </button>
                    <span className='text-muted-foreground text-xs'>
                      {tt(`${c.template}.name`)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <CampaignStatusBadge status={c.status} />
                    {c.status === 'sending' && (
                      <p className='text-muted-foreground mt-1 text-xs tabular-nums'>
                        {t('progress', { sent: c.stats.sent, total: c.stats.recipients })}
                      </p>
                    )}
                    {c.status === 'failed' && c.failure_reason && (
                      <p className='text-destructive mt-1 text-xs'>
                        {t(`failure.${c.failure_reason}`)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {c.status === 'draft' || c.status === 'scheduled'
                      ? '—'
                      : format.number(c.recipient_count)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {c.stats.recipients ? format.number(c.stats.sent) : '—'}
                  </TableCell>
                  {tracking && (
                    <TableCell className='text-right tabular-nums'>
                      {c.stats.recipients ? format.number(c.stats.delivered) : '—'}
                    </TableCell>
                  )}
                  {tracking && (
                    <TableCell className='text-right tabular-nums'>
                      {c.stats.recipients ? format.number(c.stats.bounced) : '—'}
                    </TableCell>
                  )}
                  <TableCell className='text-right tabular-nums'>
                    {c.stats.recipients ? format.number(c.stats.unsubscribed) : '—'}
                  </TableCell>
                  <TableCell className='text-muted-foreground text-sm whitespace-nowrap'>
                    {c.status === 'scheduled' && (
                      <Icons.clock
                        className='mr-1 inline size-3.5'
                        aria-label={t('scheduledFor')}
                      />
                    )}
                    {date(when)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {!tracking && (
        <p className='text-muted-foreground border-t px-4 py-3 text-xs'>{t('trackingOff')}</p>
      )}
    </Card>
  );
}
