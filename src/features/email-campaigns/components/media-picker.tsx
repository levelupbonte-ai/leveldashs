'use client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { mediaQueryOptions } from '@/features/site/api/queries';
import type { MediaItem } from '@/features/site/api/types';
import { createClient } from '@/lib/supabase/client';

/** Optional image from the website's media library (images only; never an outside URL). */
export function MediaPicker({
  websiteId,
  value,
  disabled,
  onChange
}: {
  websiteId: string;
  /** URL of the chosen image, for the thumbnail. */
  value: string | null;
  disabled?: boolean;
  onChange: (item: MediaItem | null) => void;
}) {
  const t = useTranslations('emailCampaigns.media');
  const [open, setOpen] = useState(false);
  return (
    <div className='flex flex-wrap items-center gap-3'>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element -- storage URL chosen from the media library
        <img src={value} alt='' className='bg-muted h-20 w-32 rounded-md border object-cover' />
      ) : (
        <div className='bg-muted/50 text-muted-foreground flex h-20 w-32 items-center justify-center rounded-md border border-dashed'>
          <Icons.photo className='size-5' aria-hidden />
        </div>
      )}
      <div className='flex gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {value ? t('change') : t('choose')}
        </Button>
        {value && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            {t('remove')}
          </Button>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          {open && (
            <MediaGrid
              websiteId={websiteId}
              onPick={(item) => {
                onChange(item);
                setOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MediaGrid({
  websiteId,
  onPick
}: {
  websiteId: string;
  onPick: (item: MediaItem) => void;
}) {
  const t = useTranslations('emailCampaigns.media');
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery(
    mediaQueryOptions(createClient(), websiteId, { kind: 'image', search: null })
  );
  const items = (data?.pages ?? [])
    .flatMap((p) => p.rows)
    .filter((m) => m.mime_type !== 'image/svg+xml');
  if (isLoading) {
    return (
      <div className='grid grid-cols-3 gap-3 sm:grid-cols-4'>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className='aspect-square w-full' />
        ))}
      </div>
    );
  }
  if (!items.length)
    return <p className='text-muted-foreground py-8 text-center text-sm'>{t('empty')}</p>;
  return (
    <div className='max-h-[60vh] space-y-3 overflow-y-auto'>
      <div className='grid grid-cols-3 gap-3 sm:grid-cols-4'>
        {items.map((item) => (
          <button
            key={item.id}
            type='button'
            onClick={() => onPick(item)}
            className='focus-visible:ring-ring group overflow-hidden rounded-lg border focus-visible:ring-2 focus-visible:outline-none'
            aria-label={item.alt_text || item.filename}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- media library thumbnail */}
            <img
              src={item.thumbUrl}
              alt=''
              loading='lazy'
              className='aspect-square w-full object-cover transition group-hover:scale-105'
            />
          </button>
        ))}
      </div>
      {hasNextPage && (
        <Button
          disabled={isFetchingNextPage}
          variant='outline'
          className='w-full'
          onClick={() => fetchNextPage()}
        >
          {t('more')}
        </Button>
      )}
    </div>
  );
}
