'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createClient } from '@/lib/supabase/client';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useSiteMutations } from '../api/mutations';
import { submissionsQueryOptions } from '../api/queries';
import type { SubmissionView } from '../api/service';
import type { FormSubmission, SubmissionStatus } from '../api/types';
import { NotesDialog } from './notes-dialog';
import { StatusSelect } from './status-select';
import { useSiteScope } from './use-site-scope';

const STATUS: Record<SubmissionStatus, string> = {
  new: 'Nouveau',
  contacted: 'Contacté',
  in_progress: 'En cours',
  quoted: 'Devis envoyé',
  won: 'Gagné',
  lost: 'Perdu',
  closed: 'Fermé',
  spam: 'Spam'
};

const FORM_TYPE: Record<string, string> = {
  contact: 'Contact',
  quote: 'Devis',
  vip_signup: 'VIP',
  newsletter: 'Newsletter',
  registration: 'Inscription',
  preview_request: 'Demande d’aperçu'
};

function extraFields(data: Record<string, unknown>) {
  return Object.entries(data ?? {}).filter(
    ([, v]) => v !== null && v !== '' && (typeof v !== 'object' || Array.isArray(v))
  );
}

export function SubmissionsList() {
  const [tab, setTab] = useState<SubmissionView>('open');
  return (
    <div className='space-y-4'>
      <Tabs value={tab} onValueChange={(v) => setTab(v as SubmissionView)}>
        <TabsList>
          <TabsTrigger value='open'>À traiter</TabsTrigger>
          <TabsTrigger value='all'>Toutes</TabsTrigger>
        </TabsList>
      </Tabs>
      <Suspense fallback={<Skeleton className='h-64 w-full' />}>
        <Submissions view={tab} />
      </Suspense>
    </div>
  );
}

function Submissions({ view }: { view: SubmissionView }) {
  const scope = useSiteScope();
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    submissionsQueryOptions(createClient(), scope.websiteId, view)
  );
  const rows = data.pages.flat();
  const { updateSubmission } = useSiteMutations(scope);
  const [notesFor, setNotesFor] = useState<FormSubmission | null>(null);

  return (
    <div className='space-y-4'>
      {rows.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>Aucune demande</EmptyTitle>
            <EmptyDescription>
              Les formulaires envoyés depuis votre site (contact, devis, inscriptions) arrivent ici.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className='space-y-3'>
          {rows.map((s) => (
            <Card key={s.id}>
              <CardContent className='flex flex-col gap-3 md:flex-row md:items-start'>
                <div className='min-w-0 flex-1 space-y-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <Badge variant='secondary'>{FORM_TYPE[s.form_type] ?? s.form_type}</Badge>
                    <span className='font-medium'>{s.name || 'Sans nom'}</span>
                    {s.company && (
                      <span className='text-muted-foreground text-sm'>· {s.company}</span>
                    )}
                    <span className='text-muted-foreground ml-auto text-xs'>
                      {new Date(s.created_at).toLocaleString('fr-FR')} · {s.ticket_code}
                    </span>
                  </div>
                  <div className='text-muted-foreground flex flex-wrap gap-x-4 text-sm'>
                    {s.email && (
                      <a
                        className='hover:text-primary underline-offset-4 hover:underline'
                        href={`mailto:${s.email}`}
                      >
                        {s.email}
                      </a>
                    )}
                    {s.phone && (
                      <a
                        className='hover:text-primary underline-offset-4 hover:underline'
                        href={`tel:${s.phone}`}
                      >
                        {s.phone}
                      </a>
                    )}
                  </div>
                  {s.message && <p className='text-sm whitespace-pre-wrap'>{s.message}</p>}
                  {extraFields(s.data).length > 0 && (
                    <dl className='text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 text-xs'>
                      {extraFields(s.data).map(([k, v]) => (
                        <div key={k} className='contents'>
                          <dt className='font-medium'>{k}</dt>
                          <dd className='truncate'>
                            {Array.isArray(v) ? v.join(', ') : String(v)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {s.staff_notes && (
                    <p className='bg-muted rounded-md p-2 text-xs'>Note : {s.staff_notes}</p>
                  )}
                </div>
                <div className='flex items-center gap-1'>
                  <StatusSelect
                    label='Statut de la demande'
                    value={s.status}
                    options={STATUS}
                    disabled={!scope.canEdit}
                    onChange={(status) => updateSubmission.mutate({ id: s.id, patch: { status } })}
                  />
                  <Button
                    size='icon'
                    variant='ghost'
                    aria-label='Notes internes'
                    disabled={!scope.canEdit}
                    onClick={() => setNotesFor(s)}
                  >
                    <Icons.post className='size-4' />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {hasNextPage && (
        <Button variant='outline' disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
          {isFetchingNextPage ? 'Chargement…' : 'Charger plus'}
        </Button>
      )}
      {notesFor && (
        <NotesDialog
          key={notesFor.id}
          open
          title={`Notes · ${notesFor.name || notesFor.ticket_code}`}
          initial={notesFor.staff_notes ?? ''}
          onOpenChange={(o) => !o && setNotesFor(null)}
          onSave={(staff_notes) =>
            updateSubmission.mutate({ id: notesFor.id, patch: { staff_notes } })
          }
        />
      )}
    </div>
  );
}
