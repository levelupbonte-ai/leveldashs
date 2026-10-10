'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createClient } from '@/lib/supabase/client';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Suspense, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useSiteMutations } from '../api/mutations';
import { submissionsQueryOptions } from '../api/queries';
import type { SubmissionView } from '../api/service';
import type { FormSubmission, SubmissionStatus } from '../api/types';
import { NotesDialog } from './notes-dialog';
import { StatusSelect } from './status-select';
import { useSiteScope } from './use-site-scope';

const STATUSES: SubmissionStatus[] = [
  'new',
  'contacted',
  'in_progress',
  'quoted',
  'won',
  'lost',
  'closed',
  'spam'
];

const FORM_TYPES = [
  'contact',
  'quote',
  'vip_signup',
  'newsletter',
  'registration',
  'preview_request'
] as const;

function extraFields(data: Record<string, unknown>) {
  return Object.entries(data ?? {}).filter(
    ([, v]) => v !== null && v !== '' && (typeof v !== 'object' || Array.isArray(v))
  );
}

export function SubmissionsList() {
  const [tab, setTab] = useState<SubmissionView>('open');
  const t = useTranslations('site.requests');
  return (
    <div className='space-y-4'>
      <Tabs value={tab} onValueChange={(v) => setTab(v as SubmissionView)}>
        <TabsList>
          <TabsTrigger value='open'>{t('open')}</TabsTrigger>
          <TabsTrigger value='all'>{t('all')}</TabsTrigger>
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
  const t = useTranslations('site.requests');
  const tc = useTranslations('site.content');
  const format = useFormatter();
  const statusLabels = Object.fromEntries(STATUSES.map((s) => [s, t(`status.${s}`)])) as Record<
    SubmissionStatus,
    string
  >;
  const formType = (type: string) =>
    (FORM_TYPES as readonly string[]).includes(type)
      ? t(`types.${type as (typeof FORM_TYPES)[number]}`)
      : type;

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
        <div className='space-y-3'>
          {rows.map((s) => (
            <Card key={s.id}>
              <CardContent className='flex flex-col gap-3 md:flex-row md:items-start'>
                <div className='min-w-0 flex-1 space-y-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <Badge variant='secondary'>{formType(s.form_type)}</Badge>
                    <span className='font-medium'>{s.name || t('noName')}</span>
                    {s.company && (
                      <span className='text-muted-foreground text-sm'>· {s.company}</span>
                    )}
                    <span className='text-muted-foreground ml-auto text-xs'>
                      {format.dateTime(new Date(s.created_at), {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                      })}{' '}
                      · {s.ticket_code}
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
                    <p className='bg-muted rounded-md p-2 text-xs'>
                      {t('note', { note: s.staff_notes })}
                    </p>
                  )}
                </div>
                <div className='flex items-center gap-1'>
                  <StatusSelect
                    label={t('statusAria')}
                    value={s.status}
                    options={statusLabels}
                    disabled={!scope.canEdit}
                    onChange={(status) => updateSubmission.mutate({ id: s.id, patch: { status } })}
                  />
                  <Button
                    size='icon'
                    variant='ghost'
                    aria-label={tc('notes')}
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
          {isFetchingNextPage ? tc('loading') : tc('loadMore')}
        </Button>
      )}
      {notesFor && (
        <NotesDialog
          key={notesFor.id}
          open
          title={tc('notesFor', { name: notesFor.name || notesFor.ticket_code })}
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
