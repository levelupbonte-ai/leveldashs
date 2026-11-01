'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
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
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useErrorMessage } from '@/hooks/use-error-message';
import { createClient } from '@/lib/supabase/client';
import { studioAdminKeys, studioTemplatesQueryOptions } from '../api/queries';
import { setStudioTemplatePublished } from '../api/service';
import {
  STUDIO_TEMPLATE_KINDS,
  type StudioTemplateKind,
  type StudioTemplateRow
} from '../api/types';
import { StudioPreviewDialog, type PreviewTarget } from './preview-dialog';

const COLOR = /^#[0-9a-fA-F]{3,8}$/;

/** The LevelStudio template catalog: kind, published or not, imports, preview, publish. */
export function StudioTemplatesTab() {
  const db = createClient();
  const { data: templates } = useSuspenseQuery(studioTemplatesQueryOptions(db));
  const t = useTranslations('admin.studio.templates');
  const [kind, setKind] = useState<StudioTemplateKind | 'all'>('all');
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const counts = useMemo(() => {
    const c: Record<StudioTemplateKind, number> = { starter: 0, style: 0, import: 0 };
    for (const row of templates) c[row.kind] += 1;
    return c;
  }, [templates]);
  const shown = kind === 'all' ? templates : templates.filter((row) => row.kind === kind);

  if (templates.length === 0) {
    return (
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.template />
          </EmptyMedia>
          <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card>
      <CardHeader className='gap-3'>
        <div className='space-y-1.5'>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <ToggleGroup
          aria-label={t('filterLabel')}
          variant='outline'
          size='sm'
          className='flex-wrap'
          value={[kind]}
          onValueChange={(v) => v[0] && setKind(v[0] as StudioTemplateKind | 'all')}
        >
          <ToggleGroupItem value='all'>{t('all', { count: templates.length })}</ToggleGroupItem>
          {STUDIO_TEMPLATE_KINDS.map((k) => (
            <ToggleGroupItem key={k} value={k}>
              {t(`kindFilter.${k}`, { count: counts[k] })}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardHeader>
      <CardContent>
        <ul className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          {shown.map((row) => (
            <TemplateCard
              key={row.id}
              row={row}
              onPreview={() => setPreview({ kind: 'template', id: row.id, title: row.name })}
            />
          ))}
        </ul>
      </CardContent>
      <StudioPreviewDialog target={preview} onClose={() => setPreview(null)} />
    </Card>
  );
}

function TemplateCard({ row, onPreview }: { row: StudioTemplateRow; onPreview: () => void }) {
  const t = useTranslations('admin.studio.templates');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const publish = useMutation({
    mutationFn: (published: boolean) =>
      setStudioTemplatePublished(createClient(), row.id, published),
    onSuccess: async (_data, published) => {
      toast.success(t(published ? 'publishedToast' : 'unpublishedToast', { name: row.name }));
      await queryClient.invalidateQueries({ queryKey: studioAdminKeys.templates() });
    },
    onError: (error) => toast.error(errorMessage(error, 'saveFailed'))
  });
  const palette = row.palette.filter((c) => COLOR.test(c)).slice(0, 6);
  const publishable = row.kind !== 'import';

  return (
    <li className='flex flex-col gap-3 rounded-lg border p-3'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 space-y-1'>
          <p className='truncate font-medium'>{row.name}</p>
          {row.tagline && (
            <p className='text-muted-foreground line-clamp-2 text-xs'>{row.tagline}</p>
          )}
        </div>
        <Badge variant='secondary' className='shrink-0'>
          {t(`kinds.${row.kind}`)}
        </Badge>
      </div>
      {palette.length > 0 && (
        <div className='flex items-center gap-1' aria-label={t('palette')} role='img'>
          {palette.map((c, i) => (
            <span
              key={`${c}-${i}`}
              className='size-5 rounded-full border'
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
      <div className='text-muted-foreground space-y-0.5 text-xs'>
        <p>{t('uses', { count: row.uses })}</p>
        {row.kind === 'import' && (
          <p>
            {row.owner_is_visitor || !row.owner_email_masked
              ? t('ownerVisitor')
              : t('owner', { email: row.owner_email_masked })}
          </p>
        )}
        <p>
          {t('updated', {
            date: format.dateTime(new Date(row.updated_at), { dateStyle: 'medium' })
          })}
        </p>
      </div>
      <div className='mt-auto flex items-center justify-between gap-2 border-t pt-3'>
        {publishable ? (
          <label className='flex items-center gap-2 text-sm'>
            <Switch
              size='sm'
              checked={row.is_published}
              disabled={publish.isPending}
              aria-label={t('publishLabel', { name: row.name })}
              onCheckedChange={(checked) => publish.mutate(checked)}
            />
            <span>{row.is_published ? t('published') : t('unpublished')}</span>
          </label>
        ) : (
          <span className='text-muted-foreground flex items-center gap-1.5 text-xs'>
            <Icons.lock className='size-3.5' aria-hidden /> {t('importPrivate')}
          </span>
        )}
        {row.has_html ? (
          <Button size='sm' variant='outline' onClick={onPreview}>
            <Icons.eye aria-hidden /> {t('preview')}
          </Button>
        ) : (
          <span className='text-muted-foreground text-xs'>{t('noPreview')}</span>
        )}
      </div>
    </li>
  );
}
