'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useQueryStates } from 'nuqs';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Pager, SearchBox } from '@/features/insights/components/table-tools';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { useErrorMessage } from '@/hooks/use-error-message';
import { downloadCsv, toCsv } from '@/lib/csv';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { contactsQueryOptions, emailKeys } from '../api/queries';
import { exportContacts, unsubscribeContact } from '../api/service';
import {
  CONTACT_STATUSES,
  type Contact,
  type ContactStatus,
  type EmailOverview
} from '../api/types';
import { emailParams, toContactFilters } from '../lib/filters';
import { ImportDialog } from './import-dialog';
import { ContactStatusBadge } from './status-badge';

/**
 * Opted-in contacts of the website. Viewers see masked addresses and cannot
 * search by address; owners and admins import (with a consent confirmation),
 * export and unsubscribe someone who asked.
 */
export function ContactsPanel({ overview }: { overview: EmailOverview }) {
  const scope = useSiteScope();
  const t = useTranslations('emailCampaigns.contacts');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(emailParams, {
    startTransition,
    shallow: true,
    history: 'replace'
  });
  const filters = toContactFilters(params);
  const db = createClient();
  const { data, isLoading } = useQuery({
    ...contactsQueryOptions(db, scope.websiteId, filters),
    placeholderData: keepPreviousData
  });
  const [importOpen, setImportOpen] = useState(false);
  const [toUnsubscribe, setToUnsubscribe] = useState<Contact | null>(null);
  const canAdmin = overview.can_send;

  const exportCsv = useMutation({
    mutationFn: () => exportContacts(db, scope.websiteId),
    onSuccess: (rows) => {
      downloadCsv(
        `contacts-${scope.websiteId}-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(
          [
            'email',
            'name',
            'status',
            'source',
            'consent_at',
            'consent_source',
            'status_changed_at',
            'created_at'
          ],
          rows.map((r) => [
            r.email,
            r.name,
            r.status,
            r.source,
            r.consent_at,
            r.consent_source,
            r.status_changed_at,
            r.created_at
          ])
        )
      );
      toast.success(t('exported', { count: rows.length }));
    },
    onError: (e) => toast.error(errorMessage(e))
  });
  const unsubscribe = useMutation({
    mutationFn: (id: string) => unsubscribeContact(db, id),
    onSuccess: async () => {
      toast.success(t('unsubscribed'));
      await queryClient.invalidateQueries({ queryKey: emailKeys.all(scope.websiteId) });
    },
    onError: (e) => toast.error(errorMessage(e))
  });

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const page = data;

  return (
    <div className={cn('space-y-4 transition-opacity', isPending && 'opacity-70')}>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex flex-wrap items-center gap-2'>
          {page?.pii !== false && (
            <SearchBox
              value={params.q}
              onChange={(q) => setParams({ q, page: 1 })}
              placeholder={t('search')}
              label={t('search')}
            />
          )}
          <Select
            value={params.status ?? 'all'}
            onValueChange={(v) =>
              setParams({ status: v === 'all' ? null : (v as ContactStatus), page: 1 })
            }
          >
            <SelectTrigger className='w-[180px]' aria-label={t('statusFilter')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>{t('allStatuses')}</SelectItem>
              {CONTACT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`statusOption.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canAdmin && (
          <div className='flex gap-2'>
            <Button variant='outline' size='sm' onClick={() => setImportOpen(true)}>
              <Icons.upload className='size-4' aria-hidden />
              {t('import')}
            </Button>
            <Button
              disabled={exportCsv.isPending}
              variant='outline'
              size='sm'
              onClick={() => exportCsv.mutate()}
            >
              <Icons.download className='size-4' aria-hidden />
              {t('export')}
            </Button>
          </div>
        )}
      </div>

      <p className='text-muted-foreground text-xs'>{t('sourcesHint')}</p>

      {isLoading || !page ? (
        <Skeleton className='h-64 w-full' />
      ) : page.total === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Icons.teams />
            </EmptyMedia>
            <EmptyTitle>
              {filters.search || filters.status ? t('noMatch') : t('emptyTitle')}
            </EmptyTitle>
            <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className='overflow-hidden py-0'>
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('email')}</TableHead>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('source')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead>{t('consent')}</TableHead>
                  {canAdmin && <TableHead className='w-0' />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className='font-medium'>{c.email}</TableCell>
                    <TableCell>{c.name ?? '—'}</TableCell>
                    <TableCell className='text-muted-foreground'>
                      {t(`sourceOption.${c.source}`)}
                    </TableCell>
                    <TableCell>
                      <ContactStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className='text-muted-foreground whitespace-nowrap'>
                      {date(c.consent_at)}
                    </TableCell>
                    {canAdmin && (
                      <TableCell>
                        {c.status === 'subscribed' && (
                          <Button variant='ghost' size='sm' onClick={() => setToUnsubscribe(c)}>
                            {t('unsubscribe')}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className='border-t px-4 py-2'>
            <Pager
              page={filters.page}
              perPage={filters.perPage}
              total={page.total}
              onPage={(p) => setParams({ page: p })}
            />
          </div>
        </Card>
      )}
      {!page?.pii && page && <p className='text-muted-foreground text-xs'>{t('maskedHint')}</p>}

      {canAdmin && <ImportDialog open={importOpen} onOpenChange={setImportOpen} />}
      <AlertDialog open={!!toUnsubscribe} onOpenChange={(v) => !v && setToUnsubscribe(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unsubscribeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('unsubscribeDescription', { email: toUnsubscribe?.email ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toUnsubscribe) unsubscribe.mutate(toUnsubscribe.id);
                setToUnsubscribe(null);
              }}
            >
              {t('unsubscribe')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
