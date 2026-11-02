'use client';

import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useQueryStates } from 'nuqs';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useErrorMessage } from '@/hooks/use-error-message';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { Pager, SearchBox } from '@/features/insights/components/table-tools';
import { studioSitesQueryOptions } from '../api/queries';
import { revealStudioCreatorEmail } from '../api/service';
import { STUDIO_SITE_STATUSES, type StudioSiteRow, type StudioSiteStatus } from '../api/types';
import { studioParams, toStudioSiteFilters } from '../lib/filters';
import { studioShareUrl } from '../lib/preview';
import { StudioPreviewDialog, type PreviewTarget } from './preview-dialog';

/** Sites generated in LevelStudio: paginated, searchable, read-only. */
export function StudioSitesTab() {
  const [isPending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(studioParams, {
    startTransition,
    shallow: true,
    history: 'replace'
  });
  const filters = toStudioSiteFilters(params);
  const { data: page } = useSuspenseQuery(studioSitesQueryOptions(createClient(), filters));
  const t = useTranslations('admin.studio.sites');
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  if (page.counts.all === 0) {
    return (
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.world />
          </EmptyMedia>
          <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card className={cn('transition-opacity', isPending && 'opacity-60')} aria-busy={isPending}>
      <CardHeader className='gap-3'>
        <div className='space-y-1.5'>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>
            {t('description', { all: page.counts.all, shared: page.counts.shared })}
          </CardDescription>
        </div>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
          <SearchBox
            value={params.q}
            onChange={(q) => setParams({ q, page: 1 })}
            label={t('search')}
            placeholder={t('searchPlaceholder')}
          />
          <NativeSelect
            aria-label={t('statusLabel')}
            value={filters.status ?? ''}
            onChange={(e) =>
              setParams({ status: (e.target.value || null) as StudioSiteStatus | null, page: 1 })
            }
            className='h-9 min-w-40'
          >
            <NativeSelectOption value=''>{t('statusAll')}</NativeSelectOption>
            {STUDIO_SITE_STATUSES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {t(`status.${s}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {page.rows.length === 0 ? (
          <p className='text-muted-foreground py-10 text-center text-sm'>{t('noResults')}</p>
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.title')}</TableHead>
                  <TableHead>{t('columns.creator')}</TableHead>
                  <TableHead>{t('columns.status')}</TableHead>
                  <TableHead className='text-right'>{t('columns.versions')}</TableHead>
                  <TableHead>{t('columns.created')}</TableHead>
                  <TableHead>{t('columns.updated')}</TableHead>
                  <TableHead className='text-right'>{t('columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((row) => (
                  <SiteRow
                    key={row.id}
                    row={row}
                    onPreview={() => setPreview({ kind: 'site', id: row.id, title: row.title })}
                  />
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
      <StudioPreviewDialog target={preview} onClose={() => setPreview(null)} />
    </Card>
  );
}

function SiteRow({ row, onPreview }: { row: StudioSiteRow; onPreview: () => void }) {
  const t = useTranslations('admin.studio.sites');
  const format = useFormatter();
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const shareUrl = studioShareUrl(row.share_path);

  return (
    <TableRow>
      <TableCell className='max-w-64'>
        <p className='truncate font-medium'>{row.title}</p>
        <div className='text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs'>
          {row.template_name && <span>{t('fromTemplate', { name: row.template_name })}</span>}
          {row.generating && <Badge variant='outline'>{t('generating')}</Badge>}
          {row.archived && <Badge variant='outline'>{t('archived')}</Badge>}
        </div>
      </TableCell>
      <TableCell>
        <CreatorCell row={row} />
      </TableCell>
      <TableCell>
        <Badge variant={row.status === 'shared' ? 'default' : 'secondary'}>
          {t(`status.${row.status}`)}
        </Badge>
      </TableCell>
      <TableCell className='text-right tabular-nums'>{row.versions}</TableCell>
      <TableCell className='whitespace-nowrap'>{date(row.created_at)}</TableCell>
      <TableCell className='whitespace-nowrap'>{date(row.updated_at)}</TableCell>
      <TableCell>
        <div className='flex justify-end gap-2'>
          {row.has_html ? (
            <Button
              size='sm'
              variant='outline'
              onClick={onPreview}
              aria-label={t('previewLabel', { title: row.title })}
            >
              <Icons.eye aria-hidden /> {t('preview')}
            </Button>
          ) : (
            <span className='text-muted-foreground self-center text-xs whitespace-nowrap'>
              {t('noPreview')}
            </span>
          )}
          {shareUrl ? (
            <a
              href={shareUrl}
              target='_blank'
              rel='noopener noreferrer'
              aria-label={t('openLabel', { title: row.title })}
              className={buttonVariants({ size: 'sm', variant: 'ghost' })}
            >
              <Icons.externalLink aria-hidden /> {t('open')}
            </a>
          ) : (
            <span className='text-muted-foreground self-center text-xs whitespace-nowrap'>
              {t('noLink')}
            </span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Masked e-mail; the full one only on purpose (audited). */
function CreatorCell({ row }: { row: StudioSiteRow }) {
  const t = useTranslations('admin.studio.sites');
  const errorMessage = useErrorMessage();
  const reveal = useMutation({
    mutationFn: () => revealStudioCreatorEmail(createClient(), row.id),
    onError: (error) => toast.error(errorMessage(error))
  });
  if (!row.creator_has_account || !row.creator_email_masked) {
    return <span className='text-muted-foreground text-xs'>{t('visitor')}</span>;
  }
  if (reveal.data) return <span className='text-sm break-all'>{reveal.data}</span>;
  return (
    <div className='flex items-center gap-1.5'>
      <span className='text-sm'>{row.creator_email_masked}</span>
      <Button
        size='icon-xs'
        variant='ghost'
        disabled={reveal.isPending}
        onClick={() => reveal.mutate()}
        aria-label={t('showEmailLabel', { title: row.title })}
        title={t('showEmail')}
      >
        <Icons.eye aria-hidden />
      </Button>
    </div>
  );
}
