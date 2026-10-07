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
import { useSuspenseQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSiteMutations } from '../api/mutations';
import { appointmentsQueryOptions } from '../api/queries';
import type { Appointment, AppointmentStatus } from '../api/types';
import { NotesDialog } from './notes-dialog';
import { StatusSelect } from './status-select';
import { useSiteScope } from './use-site-scope';

const STATUS: Record<AppointmentStatus, string> = {
  pending: 'En attente',
  confirmed: 'Confirmé',
  completed: 'Terminé',
  cancelled: 'Annulé',
  no_show: 'Absent'
};

function formatDate(date: string, time: string) {
  const d = new Date(`${date}T${time}`);
  return d.toLocaleString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function AppointmentsTable() {
  const scope = useSiteScope();
  const { data } = useSuspenseQuery(appointmentsQueryOptions(createClient(), scope.websiteId));
  const { updateAppointment } = useSiteMutations(scope);
  const [tab, setTab] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [notesFor, setNotesFor] = useState<Appointment | null>(null);

  const rows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (tab === 'all') return data;
    if (tab === 'past') return data.filter((a) => a.appointment_date < today);
    return data
      .filter((a) => a.appointment_date >= today && ['pending', 'confirmed'].includes(a.status))
      .toSorted((a, b) =>
        `${a.appointment_date}${a.appointment_time}`.localeCompare(
          `${b.appointment_date}${b.appointment_time}`
        )
      );
  }, [data, tab]);

  return (
    <div className='space-y-4'>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value='upcoming'>À venir</TabsTrigger>
          <TabsTrigger value='past'>Passés</TabsTrigger>
          <TabsTrigger value='all'>Tous</TabsTrigger>
        </TabsList>
      </Tabs>
      {rows.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>Aucun rendez-vous</EmptyTitle>
            <EmptyDescription>
              Les réservations faites sur votre site apparaîtront ici.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Statut</TableHead>
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
                      label='Statut du rendez-vous'
                      value={a.status}
                      options={STATUS}
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
                      aria-label='Notes internes'
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
      {notesFor && (
        <NotesDialog
          key={notesFor.id}
          open
          title={`Notes · ${notesFor.customer_name}`}
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
