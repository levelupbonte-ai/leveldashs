'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useQueryStates } from 'nuqs';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { useErrorMessage } from '@/hooks/use-error-message';
import { createClient } from '@/lib/supabase/client';
import { mailtoHref, safeLinkHref, EXTERNAL_LINK_REL } from '@/lib/validation/sanitize';
import { cn } from '@/lib/utils';
import { Pager, SearchBox } from '@/features/insights/components/table-tools';
import { displayValue, fieldLabel } from '@/features/submissions/lib/fields';
import { NotesDialog } from '@/features/site/components/notes-dialog';
import { StatusSelect } from '@/features/site/components/status-select';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { projectRequestKeys, projectRequestsQueryOptions } from '../api/queries';
import { updateProjectRequest } from '../api/service';
import {
  AI_VERDICTS,
  PROJECT_REQUEST_STATUSES,
  type ProjectRequest,
  type ProjectRequestStatus
} from '../api/types';
import { projectRequestParams, toProjectRequestFilters } from '../lib/filters';
import { useNow } from '@/features/insights/lib/use-now';

const VERDICT_VARIANT = { qualified: 'default', review: 'secondary', rejected: 'outline' } as const;

/**
 * "Start a project" requests sent from the LevelUp website, with the AI
 * triage (verdict, score, summary). Owners / admins set the status and notes.
 */
export function ProjectRequestsView() {
  const scope = useSiteScope();
  const [isPending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(projectRequestParams, {
    startTransition,
    shallow: true,
    history: 'replace'
  });
  const filters = toProjectRequestFilters(params);
  const { data } = useSuspenseQuery(
    projectRequestsQueryOptions(createClient(), scope.websiteId, filters)
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const t = useTranslations('insights.projectRequests');
  const now = useNow();
  const format = useFormatter();
  const selected = data.rows.find((r) => r.id === openId) ?? null;

  return (
    <div
      className={cn('space-y-4 transition-opacity', isPending && 'opacity-60')}
      aria-busy={isPending}
    >
      <Card>
        <CardHeader className='gap-3'>
          <div className='flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center'>
            <SearchBox
              value={params.q}
              onChange={(q) => setParams({ q, page: 1 })}
              label={t('search')}
              placeholder={t('searchPlaceholder')}
            />
            <NativeSelect
              aria-label={t('statusFilter')}
              value={params.status ?? ''}
              onChange={(e) =>
                setParams({
                  status: (e.target.value || null) as ProjectRequestStatus | null,
                  page: 1
                })
              }
              className='h-9 min-w-40'
            >
              <NativeSelectOption value=''>{t('allStatuses')}</NativeSelectOption>
              {PROJECT_REQUEST_STATUSES.map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {t(`status.${s}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label={t('verdictFilter')}
              value={params.verdict ?? ''}
              onChange={(e) =>
                setParams({
                  verdict: (e.target.value || null) as (typeof AI_VERDICTS)[number] | null,
                  page: 1
                })
              }
              className='h-9 min-w-40'
            >
              <NativeSelectOption value=''>{t('allVerdicts')}</NativeSelectOption>
              {AI_VERDICTS.map((v) => (
                <NativeSelectOption key={v} value={v}>
                  {t(`verdict.${v}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {data.rows.some((r) => r.masked) && (
            <p className='text-muted-foreground text-xs'>{t('masked')}</p>
          )}
        </CardHeader>
        <CardContent className='space-y-3'>
          {data.rows.length === 0 ? (
            <Empty className='border'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Icons.briefcase />
                </EmptyMedia>
                <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className='divide-y'>
              {data.rows.map((r) => (
                <li key={r.id}>
                  <button
                    type='button'
                    onClick={() => setOpenId(r.id)}
                    className='hover:bg-muted/40 flex w-full flex-col gap-1 rounded-md px-2 py-3 text-left sm:flex-row sm:items-center sm:gap-4'
                  >
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate font-medium'>
                        {r.business_name || r.name || '–'}
                      </span>
                      <span className='text-muted-foreground block truncate text-xs'>
                        {[r.project_type, r.budget, r.timeline].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className='flex shrink-0 flex-wrap items-center gap-2'>
                      {r.ai_verdict && (
                        <Badge variant={VERDICT_VARIANT[r.ai_verdict]}>
                          {t(`verdict.${r.ai_verdict}`)}
                          {r.ai_score !== null && (
                            <span className='tabular-nums'> · {r.ai_score}</span>
                          )}
                        </Badge>
                      )}
                      <Badge variant='outline'>{t(`status.${r.status}`)}</Badge>
                      {r.handoff?.claimed_at && <Badge variant='secondary'>{t('claimed')}</Badge>}
                      <span className='text-muted-foreground text-xs'>
                        {format.relativeTime(new Date(r.created_at), now)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Pager
            page={filters.page}
            perPage={filters.perPage}
            total={data.total}
            onPage={(p) => setParams({ page: p })}
          />
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setOpenId(null)}>
        <SheetContent className='w-full overflow-y-auto sm:max-w-xl'>
          {selected && <RequestDetail request={selected} canEdit={data.can_edit} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RequestDetail({ request: r, canEdit }: { request: ProjectRequest; canEdit: boolean }) {
  const scope = useSiteScope();
  const t = useTranslations('insights.projectRequests');
  const tc = useTranslations('site.content');
  const now = useNow();
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [notesOpen, setNotesOpen] = useState(false);
  const update = useMutation({
    mutationFn: (patch: { status?: ProjectRequestStatus; notes?: string }) =>
      updateProjectRequest(createClient(), scope.websiteId, r.id, patch),
    onSuccess: () => {
      toast.success(t('saved'));
      void queryClient.invalidateQueries({ queryKey: projectRequestKeys.all(scope.websiteId) });
    },
    onError: (error) => toast.error(errorMessage(error))
  });
  const statusLabels = Object.fromEntries(
    PROJECT_REQUEST_STATUSES.map((s) => [s, t(`status.${s}`)])
  ) as Record<ProjectRequestStatus, string>;
  const reasons = Array.isArray(r.ai_reasons) ? r.ai_reasons : [];
  const flags = Array.isArray(r.ai_red_flags) ? r.ai_red_flags : [];
  const details: [string, React.ReactNode][] = [
    [t('contact'), r.name || '–'],
    [
      t('email'),
      r.email ? (
        mailtoHref(r.email) ? (
          <a key='email' className='underline-offset-4 hover:underline' href={mailtoHref(r.email)!}>
            {r.email}
          </a>
        ) : (
          r.email
        )
      ) : (
        '–'
      )
    ],
    [t('phone'), r.phone || '–'],
    [
      t('website'),
      r.website && safeLinkHref(r.website) ? (
        <a
          key='website'
          className='underline-offset-4 hover:underline break-all'
          href={safeLinkHref(r.website)!}
          target='_blank'
          rel={EXTERNAL_LINK_REL}
        >
          {r.website}
        </a>
      ) : (
        r.website || '–'
      )
    ],
    [t('sector'), r.sector || '–'],
    [t('stage'), [r.business_stage, r.business_age].filter(Boolean).join(' · ') || '–'],
    [t('budget'), r.budget || '–'],
    [t('timeline'), r.timeline || '–'],
    [t('language'), r.locale || '–'],
    [
      t('handoff'),
      r.handoff
        ? r.handoff.claimed_at
          ? t('handoffClaimed', { date: format.relativeTime(new Date(r.handoff.claimed_at), now) })
          : t('handoffOpen', { count: r.handoff.open_count })
        : '–'
    ]
  ];
  const brief = Object.entries(r.brief ?? {}).filter(([, v]) => v !== null && v !== '');
  return (
    <>
      <SheetHeader>
        <SheetTitle>{r.business_name || r.name || t('untitled')}</SheetTitle>
        <SheetDescription>
          {[
            r.project_type,
            format.dateTime(new Date(r.created_at), { dateStyle: 'medium', timeStyle: 'short' })
          ]
            .filter(Boolean)
            .join(' · ')}
        </SheetDescription>
      </SheetHeader>
      <div className='space-y-5 px-4 pb-6'>
        <section className='bg-muted/50 space-y-2 rounded-md p-3'>
          <div className='flex items-center justify-between gap-2'>
            <h3 className='text-sm font-medium'>{t('triage')}</h3>
            {r.ai_verdict && (
              <Badge variant={VERDICT_VARIANT[r.ai_verdict]}>
                {t(`verdict.${r.ai_verdict}`)}
                {r.ai_score !== null && <span className='tabular-nums'> · {r.ai_score}/100</span>}
              </Badge>
            )}
          </div>
          {r.ai_summary && <p className='text-sm'>{r.ai_summary}</p>}
          {reasons.length > 0 && (
            <ul className='list-disc space-y-0.5 pl-5 text-sm'>
              {reasons.map((x, i) => (
                <li key={i}>{displayValue(x, 400)}</li>
              ))}
            </ul>
          )}
          {flags.length > 0 && (
            <div className='text-sm'>
              <p className='font-medium'>{t('redFlags')}</p>
              <ul className='list-disc space-y-0.5 pl-5'>
                {flags.map((x, i) => (
                  <li key={i}>{displayValue(x, 400)}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <div className='flex flex-wrap items-center gap-2'>
          <StatusSelect
            label={t('statusFilter')}
            value={r.status}
            options={statusLabels}
            disabled={!canEdit || update.isPending}
            onChange={(status) => update.mutate({ status })}
          />
          {canEdit && (
            <Button size='sm' variant='outline' onClick={() => setNotesOpen(true)}>
              <Icons.edit className='mr-1 size-4' /> {t('editNotes')}
            </Button>
          )}
        </div>
        <dl className='grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm'>
          {details.map(([label, value]) => (
            <div key={label} className='contents'>
              <dt className='text-muted-foreground'>{label}</dt>
              <dd className='min-w-0 break-words'>{value}</dd>
            </div>
          ))}
        </dl>
        {brief.length > 0 && (
          <section className='space-y-2'>
            <h3 className='text-sm font-medium'>{t('brief')}</h3>
            <dl className='grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm'>
              {brief.map(([k, v]) => (
                <div key={k} className='contents'>
                  <dt className='text-muted-foreground break-words'>{fieldLabel(k)}</dt>
                  <dd className='min-w-0 break-words whitespace-pre-wrap'>{displayValue(v)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {(r.notes || canEdit) && (
          <section className='space-y-1'>
            <h3 className='text-sm font-medium'>{tc('notes')}</h3>
            <p className='bg-muted min-h-10 rounded-md p-2 text-sm whitespace-pre-wrap'>
              {r.notes || <span className='text-muted-foreground'>{t('noNotes')}</span>}
            </p>
          </section>
        )}
        <p className='text-muted-foreground text-xs'>{t('hqLater')}</p>
      </div>
      {notesOpen && (
        <NotesDialog
          open
          title={tc('notesFor', { name: r.business_name || r.name || '' })}
          initial={r.notes ?? ''}
          onOpenChange={setNotesOpen}
          onSave={(notes) => update.mutate({ notes: notes ?? '' })}
        />
      )}
    </>
  );
}
