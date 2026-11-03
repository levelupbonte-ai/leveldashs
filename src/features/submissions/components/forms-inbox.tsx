'use client';

import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useQueryStates } from 'nuqs';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useErrorMessage } from '@/hooks/use-error-message';
import { downloadCsv, toCsv } from '@/lib/csv';
import { createClient } from '@/lib/supabase/client';
import { mailtoHref, telHref } from '@/lib/validation/sanitize';
import { cn } from '@/lib/utils';
import { capabilitiesQueryOptions } from '@/features/insights/api/queries';
import { Pager, SearchBox } from '@/features/insights/components/table-tools';
import { useFormTypeLabel } from '@/features/insights/components/use-labels';
import { useSiteMutations } from '@/features/site/api/mutations';
import { NotesDialog } from '@/features/site/components/notes-dialog';
import { StatusSelect } from '@/features/site/components/status-select';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { submissionPageQueryOptions } from '../api/queries';
import { exportSubmissions } from '../api/service';
import {
  SUBMISSION_VIEWS,
  type FormSubmission,
  type SubmissionStatus,
  type SubmissionView
} from '../api/types';
import { detectDataFields, displayValue, fieldLabel, uploadedFiles } from '../lib/fields';
import { UploadedFiles } from './uploaded-files';
import { submissionParams, toSubmissionFilters } from '../lib/filters';

const STATUSES: SubmissionStatus[] = [
  'new',
  'contacted',
  'in_progress',
  'quoted',
  'won',
  'lost',
  'closed',
  'archived',
  'spam'
];

/** Base columns; any key found in `data` can be added from the column chooser. */
const BASE_COLUMNS = ['name', 'email', 'phone', 'company', 'message'] as const;
type BaseColumn = (typeof BASE_COLUMNS)[number];
const DEFAULT_COLUMNS: string[] = ['name', 'email', 'message'];
const COLUMNS_STORAGE = 'lu.inbox.columns';

function readColumns(formType: string | null): string[] {
  try {
    const raw = window.localStorage.getItem(`${COLUMNS_STORAGE}.${formType ?? 'all'}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === 'string').slice(0, 20)
      : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function writeColumns(formType: string | null, columns: string[]) {
  try {
    window.localStorage.setItem(`${COLUMNS_STORAGE}.${formType ?? 'all'}`, JSON.stringify(columns));
  } catch {
    // Private mode or blocked storage: the choice lasts for this visit only.
  }
}

function cellValue(row: FormSubmission, column: string): string {
  if ((BASE_COLUMNS as readonly string[]).includes(column)) {
    return row[column as BaseColumn] ?? '';
  }
  return displayValue(row.data?.[column], 300);
}

/**
 * Inbox for every form the website sends (contact, quotes, sign-ups and any
 * custom form): the fields are detected from the data, so a new form shows
 * up with its own columns without configuration. Values are rendered as text.
 */
export function FormsInbox() {
  const scope = useSiteScope();
  const [isPending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(submissionParams, {
    startTransition,
    shallow: true,
    history: 'replace'
  });
  const filters = toSubmissionFilters(params);
  const db = createClient();
  const { data: page } = useSuspenseQuery(submissionPageQueryOptions(db, scope.websiteId, filters));
  const { data: caps } = useSuspenseQuery(capabilitiesQueryOptions(db, scope.websiteId));
  const { updateSubmission } = useSiteMutations(scope);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<FormSubmission | null>(null);
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const t = useTranslations('insights.inbox');
  const tr = useTranslations('site.requests');
  const tc = useTranslations('site.content');
  const format = useFormatter();
  const typeLabel = useFormTypeLabel();
  const errorMessage = useErrorMessage();

  useEffect(() => setColumns(readColumns(filters.formType)), [filters.formType]);

  const dataFields = useMemo(() => detectDataFields(page.rows), [page.rows]);
  const visible = columns.filter(
    (c) => (BASE_COLUMNS as readonly string[]).includes(c) || dataFields.includes(c)
  );
  const toggleColumn = (column: string) => {
    const next = columns.includes(column)
      ? columns.filter((c) => c !== column)
      : [...columns, column];
    setColumns(next);
    writeColumns(filters.formType, next);
  };
  const columnLabel = (c: string) =>
    (BASE_COLUMNS as readonly string[]).includes(c)
      ? t(`columns.${c as BaseColumn}`)
      : fieldLabel(c);
  const statusLabels = Object.fromEntries(STATUSES.map((s) => [s, tr(`status.${s}`)])) as Record<
    SubmissionStatus,
    string
  >;
  const forms = caps?.forms ?? [];
  const selected = page.rows.find((r) => r.id === openId) ?? null;
  const setStatus = (row: FormSubmission, status: SubmissionStatus) =>
    updateSubmission.mutate(
      { id: row.id, patch: { status } },
      { onSuccess: () => toast.success(t('statusSaved', { status: statusLabels[status] })) }
    );

  const exportCsv = useMutation({
    mutationFn: () => exportSubmissions(db, scope.websiteId, filters),
    onSuccess: (rows) => {
      const keys = detectDataFields(rows, 60);
      const csv = toCsv(
        ['date', 'ticket', 'form', 'status', ...BASE_COLUMNS, ...keys, 'notes'],
        rows.map((r) => [
          r.created_at,
          r.ticket_code,
          r.form_type,
          r.status,
          ...BASE_COLUMNS.map((c) => r[c]),
          ...keys.map((k) => displayValue(r.data?.[k], 5000)),
          r.staff_notes
        ])
      );
      downloadCsv(
        `forms-${filters.formType ?? 'all'}-${new Date().toISOString().slice(0, 10)}.csv`,
        csv
      );
      toast.success(t('exported', { count: rows.length }));
    },
    onError: (error) => toast.error(errorMessage(error))
  });

  return (
    <div
      className={cn('space-y-4 transition-opacity', isPending && 'opacity-60')}
      aria-busy={isPending}
    >
      <Tabs
        value={params.view}
        onValueChange={(v) => setParams({ view: v as SubmissionView, page: 1 })}
      >
        <TabsList className='max-w-full overflow-x-auto'>
          {SUBMISSION_VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`views.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader className='gap-3'>
          <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
              <NativeSelect
                aria-label={t('formFilter')}
                value={filters.formType ?? ''}
                onChange={(e) => setParams({ type: e.target.value, page: 1 })}
                className='h-9 min-w-44'
              >
                <NativeSelectOption value=''>{t('allForms')}</NativeSelectOption>
                {forms.map((f) => (
                  <NativeSelectOption key={f.form_type} value={f.form_type}>
                    {typeLabel(f.form_type)} ({f.total})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <SearchBox
                value={params.q}
                onChange={(q) => setParams({ q, page: 1 })}
                label={t('search')}
                placeholder={t('searchPlaceholder')}
              />
            </div>
            <div className='flex gap-2'>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant='outline' size='sm' />}>
                  <Icons.columns className='mr-2 size-4' /> {t('columnsButton')}
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='max-h-80 w-56 overflow-y-auto'>
                  <DropdownMenuLabel>{t('columnsTitle')}</DropdownMenuLabel>
                  {BASE_COLUMNS.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c}
                      checked={columns.includes(c)}
                      onCheckedChange={() => toggleColumn(c)}
                    >
                      {columnLabel(c)}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {dataFields.length > 0 && <DropdownMenuSeparator />}
                  {dataFields.length > 0 && (
                    <DropdownMenuLabel>{t('detectedFields')}</DropdownMenuLabel>
                  )}
                  {dataFields.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c}
                      checked={columns.includes(c)}
                      onCheckedChange={() => toggleColumn(c)}
                    >
                      {fieldLabel(c)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {scope.canEdit && (
                <Button
                  variant='outline'
                  size='sm'
                  disabled={exportCsv.isPending || page.total === 0}
                  onClick={() => exportCsv.mutate()}
                >
                  <Icons.download className='mr-2 size-4' /> {t('export')}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-4'>
          {page.rows.length === 0 ? (
            <Empty className='border'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Icons.inbox />
                </EmptyMedia>
                <EmptyTitle>
                  {params.q || filters.formType ? t('noMatch') : tr('emptyTitle')}
                </EmptyTitle>
                <EmptyDescription>{tr('emptyDescription')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('received')}</TableHead>
                    <TableHead>{t('form')}</TableHead>
                    {visible.map((c) => (
                      <TableHead key={c}>{columnLabel(c)}</TableHead>
                    ))}
                    <TableHead>{t('statusLabel')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.rows.map((row) => (
                    <TableRow
                      key={row.id}
                      tabIndex={0}
                      className={cn('cursor-pointer', row.status === 'new' && 'font-medium')}
                      onClick={() => setOpenId(row.id)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpenId(row.id)}
                    >
                      <TableCell className='whitespace-nowrap'>
                        {format.dateTime(new Date(row.created_at), {
                          dateStyle: 'medium',
                          timeStyle: 'short'
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant='secondary'>{typeLabel(row.form_type)}</Badge>
                      </TableCell>
                      {visible.map((c) => (
                        <TableCell key={c} className='max-w-64 truncate'>
                          {cellValue(row, c) || <span className='text-muted-foreground'>–</span>}
                        </TableCell>
                      ))}
                      <TableCell>
                        <Badge variant={row.status === 'new' ? 'default' : 'outline'}>
                          {statusLabels[row.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pager
            page={filters.page}
            perPage={filters.perPage}
            total={page.total}
            onPage={(p) => setParams({ page: p })}
          />
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setOpenId(null)}>
        <SheetContent className='w-full overflow-y-auto sm:max-w-lg'>
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.name || selected.email || selected.ticket_code}</SheetTitle>
                <SheetDescription>
                  {typeLabel(selected.form_type)} · {selected.ticket_code} ·{' '}
                  {format.dateTime(new Date(selected.created_at), {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                  })}
                </SheetDescription>
              </SheetHeader>
              <div className='space-y-5 px-4 pb-6'>
                <div className='flex flex-wrap items-center gap-2'>
                  <StatusSelect
                    label={tr('statusAria')}
                    value={selected.status}
                    options={statusLabels}
                    disabled={!scope.canEdit}
                    onChange={(status) => setStatus(selected, status)}
                  />
                  {scope.canEdit && (
                    <>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => setStatus(selected, 'closed')}
                      >
                        <Icons.check className='mr-1 size-4' /> {t('markHandled')}
                      </Button>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => setStatus(selected, 'archived')}
                      >
                        <Icons.archive className='mr-1 size-4' /> {t('archive')}
                      </Button>
                      <Button size='sm' variant='ghost' onClick={() => setStatus(selected, 'spam')}>
                        <Icons.ban className='mr-1 size-4' /> {t('spam')}
                      </Button>
                    </>
                  )}
                </div>
                <SubmissionFields row={selected} />
                <section className='space-y-2'>
                  <div className='flex items-center justify-between'>
                    <h3 className='text-sm font-medium'>{tc('notes')}</h3>
                    {scope.canEdit && (
                      <Button size='sm' variant='ghost' onClick={() => setNotesFor(selected)}>
                        <Icons.edit className='mr-1 size-4' /> {t('editNotes')}
                      </Button>
                    )}
                  </div>
                  <p className='bg-muted min-h-10 rounded-md p-2 text-sm whitespace-pre-wrap'>
                    {selected.staff_notes || (
                      <span className='text-muted-foreground'>{t('noNotes')}</span>
                    )}
                  </p>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

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

/** Every field of a submission, as text (never HTML). */
function SubmissionFields({ row }: { row: FormSubmission }) {
  const t = useTranslations('insights.inbox');
  const base: [string, React.ReactNode][] = [];
  if (row.name) base.push([t('columns.name'), row.name]);
  if (row.email) {
    const href = mailtoHref(row.email);
    base.push([
      t('columns.email'),
      href ? (
        <a key='e' className='underline-offset-4 hover:underline' href={href}>
          {row.email}
        </a>
      ) : (
        row.email
      )
    ]);
  }
  if (row.phone) {
    const href = telHref(row.phone);
    base.push([
      t('columns.phone'),
      href ? (
        <a key='p' className='underline-offset-4 hover:underline' href={href}>
          {row.phone}
        </a>
      ) : (
        row.phone
      )
    ]);
  }
  if (row.company) base.push([t('columns.company'), row.company]);
  if (row.source) base.push([t('source'), row.source]);
  const data = Object.entries(row.data ?? {}).filter(([, v]) => v !== null && v !== '');
  return (
    <div className='space-y-4'>
      <dl className='grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm'>
        {base.map(([label, value]) => (
          <div key={label} className='contents'>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='min-w-0 break-words'>{value}</dd>
          </div>
        ))}
      </dl>
      {row.message && (
        <section className='space-y-1'>
          <h3 className='text-sm font-medium'>{t('columns.message')}</h3>
          <p className='text-sm whitespace-pre-wrap'>{row.message}</p>
        </section>
      )}
      {data.length > 0 && (
        <section className='space-y-2'>
          <h3 className='text-sm font-medium'>{t('allFields')}</h3>
          <dl className='grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm'>
            {data.map(([key, value]) => (
              <div key={key} className='contents'>
                <dt className='text-muted-foreground break-words'>{fieldLabel(key)}</dt>
                <dd className='min-w-0 break-words whitespace-pre-wrap'>
                  {uploadedFiles(value).length ? (
                    <UploadedFiles files={uploadedFiles(value)} />
                  ) : (
                    displayValue(value)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
