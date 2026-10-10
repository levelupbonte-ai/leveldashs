'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { createClient } from '@/lib/supabase/client';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Suspense, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useSiteMutations } from '../api/mutations';
import { appointmentsQueryOptions } from '../api/queries';
import type { AppointmentView } from '../api/service';
import type { Appointment, AppointmentStatus } from '../api/types';
import { NotesDialog } from './notes-dialog';
import { StatusSelect } from './status-select';
import { useSiteScope } from './use-site-scope';

const STATUSES: AppointmentStatus[] = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

export function AppointmentsTable() {
  const [tab, setTab] = useState<AppointmentView>('upcoming');
  const t = useTranslations('site.appointments');
  return (
    <div className='space-y-4'>
      <Tabs value={tab} onValueChange={(v) => setTab(v as AppointmentView)}>
        <TabsList>
          <TabsTrigger value='upcoming'>{t('upcoming')}</TabsTrigger>
          <TabsTrigger value='past'>{t('past')}</TabsTrigger>
          <TabsTrigger value='all'>{t('all')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Suspense fallback={<Skeleton className='h-64 w-full' />}>
        <AppointmentsList view={tab} />
      </Suspense>
    </div>
  );
}

function AppointmentsList({ view }: { view: AppointmentView }) {
  const scope = useSiteScope();
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    appointmentsQueryOptions(createClient(), scope.websiteId, view)
  );
  const rows = data.pages.flat();
  const { updateAppointment } = useSiteMutations(scope);
  const [notesFor, setNotesFor] = useState<Appointment | null>(null);
  const t = useTranslations('site.appointments');
  const tc = useTranslations('site.content');
  const format = useFormatter();
  const statusLabels = Object.fromEntries(STATUSES.map((s) => [s, t(`status.${s}`)])) as Record<
    AppointmentStatus,
    string
  >;
  // Wall-clock time of the booking, shown as entered (no time-zone shift).
  const formatDate = (date: string, time: string) =>
    format.dateTime(new Date(`${date}T${time}Z`), {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });

  return (
    <div className='space-y-4'>
      {rows.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('date')}</TableHead>
                <TableHead>{t('customer')}</TableHead>
                <TableHead>{t('service')}</TableHead>
                <TableHead>{t('statusLabel')}</TableHead>
                <TableHead className='w-10' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className='whitespace-nowrap'>
                    <div className='font-medium'>
                      {formatDate(a.appointment_date, a.appointment_time)}
                    </div>
                    <div className='text-muted-foreground font-mono text-xs'>{a.ticket_code}</div>
                  </TableCell>
                  <TableCell>
                    <div className='font-medium'>{a.customer_name}</div>
                    <div className='text-muted-foreground text-xs'>
                      {[a.customer_phone, a.customer_email].filter(Boolean).join(' · ')}
                    </div>
                    {a.notes && (
                      <div className='text-muted-foreground mt-1 max-w-xs text-xs italic'>
                        « {a.notes} »
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div>{a.service_name ?? '—'}</div>
                    <div className='text-muted-foreground text-xs'>
                      {[a.team_member_name, a.price_label].filter(Boolean).join(' · ')}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusSelect
                      label={t('statusAria')}
                      value={a.status}
                      options={statusLabels}
                      disabled={!scope.canEdit}
                      onChange={(status) =>
                        updateAppointment.mutate({ id: a.id, patch: { status } })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size='icon'
                      variant='ghost'
                      aria-label={tc('notes')}
                      disabled={!scope.canEdit}
                      onClick={() => setNotesFor(a)}
                    >
                      <Icons.post className={a.staff_notes ? 'text-primary size-4' : 'size-4'} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {hasNextPage && (
        <Button variant='outline' disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
          {isFetchingNextPage ? tc('loading') : tc('loadMore')}
        </Button>
      )}
      {notesFor && (
        <NotesDialog
          key={notesFor.id}
          open
          title={tc('notesFor', { name: notesFor.customer_name })}
          initial={notesFor.staff_notes ?? ''}
          onOpenChange={(o) => !o && setNotesFor(null)}
          onSave={(staff_notes) =>
            updateAppointment.mutate({ id: notesFor.id, patch: { staff_notes } })
          }
        />
      )}
    </div>
  );
}
