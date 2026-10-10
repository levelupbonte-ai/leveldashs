'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { useSiteMutations } from '../api/mutations';
import { mediaQueryOptions } from '../api/queries';
import { MEDIA_MAX_BYTES, MEDIA_TYPES } from '../api/service';
import { useSiteScope } from './use-site-scope';

export function MediaLibrary() {
  const scope = useSiteScope();
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    mediaQueryOptions(createClient(), scope.websiteId)
  );
  const media = data.pages.flat();
  const { uploadMedia, deleteMedia } = useSiteMutations(scope);
  const [uploading, setUploading] = useState(0);
  const t = useTranslations('site.media');
  const tc = useTranslations('site.content');
  const format = useFormatter();
  const formatSize = (bytes: number) =>
    bytes > 1024 * 1024
      ? format.number(bytes / 1024 / 1024, {
          style: 'unit',
          unit: 'megabyte',
          maximumFractionDigits: 1
        })
      : format.number(Math.ceil(bytes / 1024), { style: 'unit', unit: 'kilobyte' });
  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast.success(t('linkCopied'));
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    disabled: !scope.canEdit,
    maxSize: MEDIA_MAX_BYTES,
    accept: Object.fromEntries(Object.keys(MEDIA_TYPES).map((t) => [t, []])),
    onDropRejected: () => toast.error(t('rejected')),
    onDropAccepted: async (files) => {
      setUploading((n) => n + files.length);
      for (const file of files) {
        try {
          await uploadMedia.mutateAsync({ file });
        } catch {
          // toast already shown
        } finally {
          setUploading((n) => n - 1);
        }
      }
    }
  });

  return (
    <div className='space-y-4'>
      {scope.canEdit && (
        <div
          {...getRootProps()}
          className={cn(
            'hover:bg-muted/50 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition',
            isDragActive && 'border-primary bg-muted/50'
          )}
        >
          <input {...getInputProps()} />
          {uploading > 0 ? (
            <Icons.spinner className='text-muted-foreground size-8 animate-spin' />
          ) : (
            <Icons.upload className='text-muted-foreground size-8' />
          )}
          <p className='font-medium'>
            {uploading > 0 ? t('uploading', { count: uploading }) : t('drop')}
          </p>
          <p className='text-muted-foreground text-xs'>{t('formats')}</p>
        </div>
      )}

      {media.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6'>
          {media.map((m) => (
            <Card key={m.id} className='group gap-0 overflow-hidden p-0'>
              <div className='bg-muted relative aspect-square'>
                {m.mime_type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URLs
                  <img
                    src={m.url}
                    alt={m.alt_text ?? ''}
                    className='size-full object-cover'
                    loading='lazy'
                  />
                ) : (
                  <div className='flex size-full items-center justify-center'>
                    {m.mime_type === 'application/pdf' ? (
                      <Icons.fileTypePdf className='text-muted-foreground size-10' />
                    ) : (
                      <Icons.video className='text-muted-foreground size-10' />
                    )}
                  </div>
                )}
                <div className='absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 p-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100'>
                  <Button
                    size='icon'
                    variant='secondary'
                    className='size-7'
                    aria-label={t('copyLink')}
                    onClick={() => copy(m.url)}
                  >
                    <Icons.copy className='size-3.5' />
                  </Button>
                  {scope.canEdit && (
                    <Button
                      size='icon'
                      variant='secondary'
                      className='size-7'
                      aria-label={tc('delete')}
                      onClick={() => {
                        if (window.confirm(t('deleteConfirm'))) {
                          deleteMedia.mutate(m, {
                            onSuccess: () => toast.success(t('deleted'))
                          });
                        }
                      }}
                    >
                      <Icons.trash className='size-3.5' />
                    </Button>
                  )}
                </div>
              </div>
              <div className='p-2'>
                <p className='truncate text-xs font-medium' title={m.filename}>
                  {m.filename}
                </p>
                <p className='text-muted-foreground text-xs'>{formatSize(m.size_bytes)}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
      {hasNextPage && (
        <Button variant='outline' disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
          {isFetchingNextPage ? tc('loading') : tc('loadMore')}
        </Button>
      )}
    </div>
  );
}
