'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Icons } from '@/components/icons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useErrorMessage } from '@/hooks/use-error-message';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { studioPreviewQueryOptions } from '../api/queries';
import { PREVIEW_SANDBOX, previewDocument } from '../lib/preview';

export interface PreviewTarget {
  kind: 'template' | 'site';
  id: string;
  title: string;
}

interface StudioPreviewDialogProps {
  target: PreviewTarget | null;
  onClose: () => void;
}

/**
 * Read-only preview of a template or a generated site. The HTML is loaded only
 * when the dialog opens (audited as studio.viewed) and shown in a sandboxed
 * iframe: scripts may run, but never with the dashboard's origin (no
 * allow-same-origin), and a Content-Security-Policy blocks every network call.
 */
export function StudioPreviewDialog({ target, onClose }: StudioPreviewDialogProps) {
  const t = useTranslations('admin.studio.preview');
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='flex h-[min(92vh,900px)] flex-col gap-3 sm:max-w-6xl'>
        {target && (
          <>
            <DialogHeader>
              <DialogTitle>{t('title', { title: target.title })}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>
            <PreviewFrame target={target} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewFrame({ target }: { target: PreviewTarget }) {
  const t = useTranslations('admin.studio.preview');
  const errorMessage = useErrorMessage();
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const { data, error, isPending } = useQuery(
    studioPreviewQueryOptions(createClient(), target.kind, target.id)
  );
  const html = data?.html ?? null;
  const doc = useMemo(() => (html ? previewDocument(html) : null), [html]);

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3'>
      <ToggleGroup
        aria-label={t('viewport')}
        variant='outline'
        size='sm'
        value={[viewport]}
        onValueChange={(v) => v[0] && setViewport(v[0] as 'desktop' | 'mobile')}
      >
        <ToggleGroupItem value='desktop'>
          <Icons.laptop aria-hidden /> {t('desktop')}
        </ToggleGroupItem>
        <ToggleGroupItem value='mobile'>
          <Icons.phone aria-hidden /> {t('mobile')}
        </ToggleGroupItem>
      </ToggleGroup>
      <div className='bg-muted/40 flex min-h-0 flex-1 justify-center overflow-hidden rounded-lg border'>
        {isPending ? (
          <Skeleton className='h-full w-full rounded-none' />
        ) : error ? (
          <p className='text-muted-foreground self-center p-6 text-sm' role='alert'>
            {errorMessage(error)}
          </p>
        ) : doc ? (
          <iframe
            title={t('frameTitle', { title: target.title })}
            srcDoc={doc}
            sandbox={PREVIEW_SANDBOX}
            referrerPolicy='no-referrer'
            className={cn(
              'h-full bg-white transition-[width]',
              viewport === 'mobile' ? 'w-[390px] max-w-full border-x' : 'w-full'
            )}
          />
        ) : (
          <p className='text-muted-foreground self-center p-6 text-sm'>{t('empty')}</p>
        )}
      </div>
    </div>
  );
}
