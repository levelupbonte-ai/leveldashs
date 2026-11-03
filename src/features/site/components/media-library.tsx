'use client';

import {
  useMutation,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery
} from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useQueryStates } from 'nuqs';
import { useEffect, useState, useTransition } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CharCounter } from '@/components/forms/char-counter';
import { Textarea } from '@/components/ui/textarea';
import { PlanLimitNotice } from '@/features/billing/components/plan-limit-notice';
import { PlanLimitError, type PlanLimitInfo } from '@/lib/plan-limit';
import { useErrorMessage } from '@/hooks/use-error-message';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useSiteMutations } from '../api/mutations';
import { mediaQueryOptions, mediaStatsQueryOptions, siteKeys } from '../api/queries';
import {
  MEDIA_IMAGE_INPUT_MAX_BYTES,
  MEDIA_MAX_BYTES,
  MEDIA_TYPES,
  uploadMedia as uploadMediaFile
} from '../api/service';
import type { MediaItem } from '../api/types';
import { MEDIA_KINDS, mediaParams, toMediaFilters } from '../lib/media-filters';
import { useSiteScope } from './use-site-scope';

function useFileSize() {
  const format = useFormatter();
  return (bytes: number) =>
    bytes >= 1024 * 1024 * 1024
      ? format.number(bytes / 1024 ** 3, {
          style: 'unit',
          unit: 'gigabyte',
          maximumFractionDigits: 2
        })
      : bytes >= 1024 * 1024
        ? format.number(bytes / 1024 ** 2, {
            style: 'unit',
            unit: 'megabyte',
            maximumFractionDigits: 1
          })
        : format.number(Math.max(1, Math.ceil(bytes / 1024)), { style: 'unit', unit: 'kilobyte' });
}

function FileIcon({ mime, className }: { mime: string; className?: string }) {
  if (mime === 'application/pdf') return <Icons.fileTypePdf className={className} aria-hidden />;
  if (mime.startsWith('video/')) return <Icons.video className={className} aria-hidden />;
  return <Icons.photo className={className} aria-hidden />;
}

/**
 * Media library of the active website: cursor pages from the media index
 * (never a bucket listing), search and type filters in the URL, browser-side
 * optimization on upload, thumbnails in the grid, details sheet with alt text.
 */
/** 'image' | 'video' | 'document' from a MIME type (same rule as the database). */
function mediaKind(type: string): string {
  return type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : 'document';
}

export function MediaLibrary() {
  const scope = useSiteScope();
  const db = createClient();
  const [isPending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(mediaParams, {
    startTransition,
    shallow: true,
    history: 'replace'
  });
  const filters = toMediaFilters(params);
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    mediaQueryOptions(db, scope.websiteId, filters)
  );
  const { data: stats } = useSuspenseQuery(mediaStatsQueryOptions(db, scope.websiteId));
  const media = data.pages.flatMap((p) => p.rows);
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  // Same as useSiteMutations().uploadMedia, but a plan limit shows the upgrade
  // notice instead of a toast (like the team and assistant limits).
  const uploadMedia = useMutation({
    mutationFn: ({ file }: { file: File }) => uploadMediaFile(db, scope, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: siteKeys.website(scope.websiteId) }),
    onError: (e) => {
      if (!(e instanceof PlanLimitError)) toast.error(errorMessage(e));
    }
  });
  const [uploading, setUploading] = useState(0);
  const [search, setSearch] = useState(params.q);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [planLimit, setPlanLimit] = useState<PlanLimitInfo | null>(null);
  const t = useTranslations('site.media');
  const tc = useTranslations('site.content');
  const fileSize = useFileSize();
  const format = useFormatter();
  const allowedKinds = stats.allowed_kinds ?? ['image', 'document'];

  // Debounced search: the URL (and the query key) change 300 ms after typing.
  useEffect(() => {
    if (search === params.q) return;
    const id = setTimeout(() => void setParams({ q: search }), 300);
    return () => clearTimeout(id);
  }, [search, params.q, setParams]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    disabled: !scope.canEdit,
    noClick: true,
    maxSize: MEDIA_IMAGE_INPUT_MAX_BYTES,
    // Only the kinds LevelUp allows for this client (videos are turned on in HQ).
    accept: Object.fromEntries(
      Object.keys(MEDIA_TYPES)
        .filter((type) => allowedKinds.includes(mediaKind(type)))
        .map((type) => [type, []])
    ),
    onDropRejected: () => toast.error(t('rejected')),
    onDropAccepted: async (files) => {
      setUploading((n) => n + files.length);
      setPlanLimit(null);
      let done = 0;
      let blocked = false;
      for (const file of files) {
        try {
          // Plan storage full: the remaining files would be refused too.
          if (blocked) continue;
          if (!file.type.startsWith('image/') && file.size > MEDIA_MAX_BYTES) {
            toast.error(t('rejected'));
            continue;
          }
          await uploadMedia.mutateAsync({ file });
          done++;
        } catch (e) {
          // the mutation shows a toast; a plan limit gets the notice instead
          if (e instanceof PlanLimitError) {
            setPlanLimit(e.info);
            blocked = true;
          }
        } finally {
          setUploading((n) => n - 1);
        }
      }
      if (done) toast.success(t('uploaded', { count: done }));
    }
  });

  const filtered = !!filters.kind || !!filters.search;

  return (
    <div className='space-y-4'>
      <div
        {...getRootProps()}
        className={cn(
          'bg-card rounded-xl border p-4 transition sm:p-5',
          isDragActive && 'border-primary ring-primary/20 ring-4'
        )}
      >
        <input {...getInputProps()} aria-label={t('choose')} />
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex items-center gap-3'>
            <div className='bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg'>
              <Icons.media className='text-muted-foreground size-5' aria-hidden />
            </div>
            <div className='min-w-0'>
              <p className='font-medium tabular-nums'>
                {t('statsFiles', { count: stats.files })}
                <span className='text-muted-foreground'> · {fileSize(stats.bytes)}</span>
              </p>
              <p className='text-muted-foreground text-xs'>
                {t('statsBreakdown', {
                  images: stats.images,
                  videos: stats.videos,
                  documents: stats.documents
                })}
              </p>
              {!allowedKinds.includes('video') && (
                <p className='text-muted-foreground mt-1 text-xs'>{t('videosOff')}</p>
              )}
              {stats.limit_bytes ? (
                <div className='mt-2 w-56 max-w-full'>
                  <div
                    className='bg-muted h-1.5 overflow-hidden rounded-full'
                    role='meter'
                    aria-valuemin={0}
                    aria-valuemax={stats.limit_bytes}
                    aria-valuenow={stats.org_bytes ?? 0}
                    aria-label={t('planStorage')}
                  >
                    <div
                      className={
                        (stats.org_bytes ?? 0) / stats.limit_bytes >= 0.9
                          ? 'bg-destructive h-full rounded-full'
                          : 'bg-primary h-full rounded-full'
                      }
                      style={{
                        width: `${Math.min(100, Math.round(((stats.org_bytes ?? 0) / stats.limit_bytes) * 100))}%`
                      }}
                    />
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs tabular-nums'>
                    {t('planStorageOf', {
                      used: fileSize(stats.org_bytes ?? 0),
                      limit: fileSize(stats.limit_bytes)
                    })}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
          {scope.canEdit && (
            <LoadingButton
              loading={uploading > 0}
              loadingLabel={t('uploading', { count: uploading })}
              onClick={open}
              className='w-full sm:w-auto'
            >
              <Icons.upload className='size-4' aria-hidden />
              {t('upload')}
            </LoadingButton>
          )}
        </div>
        {scope.canEdit && (
          <p className='text-muted-foreground mt-4 border-t pt-3 text-xs'>
            {uploading > 0 ? t('uploading', { count: uploading }) : t('dropHint')}{' '}
            <span className='hidden sm:inline'>{t('optimizedHint')}</span>
          </p>
        )}
      </div>

      {planLimit && <PlanLimitNotice info={planLimit} />}

      <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <Tabs
          value={params.kind}
          onValueChange={(kind) => void setParams({ kind: kind as (typeof MEDIA_KINDS)[number] })}
          className='min-w-0'
        >
          <TabsList className='max-w-full overflow-x-auto'>
            {MEDIA_KINDS.map((kind) => (
              <TabsTrigger key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <InputGroup className='sm:max-w-xs'>
          <InputGroupAddon>
            {isPending ? (
              <Icons.spinner className='size-4 animate-spin' aria-hidden />
            ) : (
              <Icons.search className='size-4' aria-hidden />
            )}
          </InputGroupAddon>
          <InputGroupInput
            type='search'
            value={search}
            maxLength={100}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
      </div>

      {media.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Icons.photo aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{filtered ? t('noResultsTitle') : t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>
              {filtered ? t('noResultsDescription') : t('emptyDescription')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul
          className={cn(
            'grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6',
            isPending && 'opacity-60'
          )}
        >
          {media.map((m) => (
            <li key={m.id}>
              <button
                type='button'
                onClick={() => setSelected(m)}
                className='group bg-card focus-visible:ring-ring/50 block w-full overflow-hidden rounded-xl border text-left transition outline-none hover:shadow-md focus-visible:ring-[3px]'
              >
                <div className='bg-muted relative aspect-square'>
                  {m.mime_type.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element -- public storage URLs, CDN cached
                    <img
                      src={m.thumbUrl}
                      alt={m.alt_text ?? ''}
                      width={m.width ?? undefined}
                      height={m.height ?? undefined}
                      className='size-full object-cover transition group-hover:scale-[1.02]'
                      loading='lazy'
                      decoding='async'
                    />
                  ) : (
                    <div className='flex size-full items-center justify-center'>
                      <FileIcon mime={m.mime_type} className='text-muted-foreground size-10' />
                    </div>
                  )}
                  {!m.alt_text && m.mime_type.startsWith('image/') && (
                    <Badge variant='secondary' className='absolute top-2 left-2 text-[10px]'>
                      {t('noAlt')}
                    </Badge>
                  )}
                </div>
                <div className='p-2.5'>
                  <p className='truncate text-xs font-medium' title={m.filename}>
                    {m.filename}
                  </p>
                  <p className='text-muted-foreground text-xs tabular-nums'>
                    {fileSize(m.size_bytes)}
                    {m.width && m.height ? ` · ${m.width}×${m.height}` : ''}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasNextPage && (
        <div className='flex justify-center'>
          <LoadingButton
            variant='outline'
            loading={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {tc('loadMore')}
          </LoadingButton>
        </div>
      )}

      <MediaDetails
        item={selected}
        onClose={() => setSelected(null)}
        formatDate={(iso) =>
          format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' })
        }
      />
    </div>
  );
}

function MediaDetails({
  item,
  onClose,
  formatDate
}: {
  item: MediaItem | null;
  onClose: () => void;
  formatDate: (iso: string) => string;
}) {
  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className='w-full gap-0 overflow-y-auto sm:max-w-md'>
        {item && (
          <MediaDetailsBody key={item.id} item={item} onClose={onClose} formatDate={formatDate} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function MediaDetailsBody({
  item,
  onClose,
  formatDate
}: {
  item: MediaItem;
  onClose: () => void;
  formatDate: (iso: string) => string;
}) {
  const scope = useSiteScope();
  const { deleteMedia, updateMediaAlt } = useSiteMutations(scope);
  const [alt, setAlt] = useState(item.alt_text ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const t = useTranslations('site.media');
  const fileSize = useFileSize();

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast.success(t('linkCopied'));
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle className='truncate pr-8'>{item.filename}</SheetTitle>
        <SheetDescription>{formatDate(item.created_at)}</SheetDescription>
      </SheetHeader>
      <div className='space-y-5 px-4 pb-4'>
        <div className='bg-muted flex aspect-video items-center justify-center overflow-hidden rounded-lg border'>
          {item.mime_type.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element -- public storage URL
            <img src={item.url} alt={item.alt_text ?? ''} className='size-full object-contain' />
          ) : (
            <FileIcon mime={item.mime_type} className='text-muted-foreground size-12' />
          )}
        </div>
        <dl className='grid grid-cols-2 gap-x-4 gap-y-3 text-sm'>
          <div>
            <dt className='text-muted-foreground text-xs'>{t('details.type')}</dt>
            <dd className='font-medium'>{MEDIA_TYPES[item.mime_type]?.toUpperCase()}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground text-xs'>{t('details.size')}</dt>
            <dd className='font-medium tabular-nums'>{fileSize(item.size_bytes)}</dd>
          </div>
          {item.width && item.height && (
            <div>
              <dt className='text-muted-foreground text-xs'>{t('details.dimensions')}</dt>
              <dd className='font-medium tabular-nums'>
                {item.width} × {item.height}
              </dd>
            </div>
          )}
          <div>
            <dt className='text-muted-foreground text-xs'>{t('details.cache')}</dt>
            <dd className='font-medium'>{t('details.cacheValue')}</dd>
          </div>
        </dl>
        <div className='space-y-2'>
          <Label htmlFor='media-url'>{t('details.link')}</Label>
          <div className='flex gap-2'>
            <code
              id='media-url'
              className='bg-muted min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-xs'
            >
              {item.url}
            </code>
            <Button
              size='icon'
              variant='outline'
              aria-label={t('copyLink')}
              onClick={() => copy(item.url)}
            >
              <Icons.copy className='size-4' />
            </Button>
            <a
              href={item.url}
              target='_blank'
              rel='noreferrer'
              aria-label={t('details.open')}
              className={buttonVariants({ variant: 'outline', size: 'icon' })}
            >
              <Icons.externalLink className='size-4' />
            </a>
          </div>
        </div>
        {item.mime_type.startsWith('image/') && (
          <div className='space-y-2'>
            <Label htmlFor='media-alt'>{t('details.alt')}</Label>
            <Textarea
              id='media-alt'
              rows={3}
              maxLength={500}
              value={alt}
              disabled={!scope.canEdit}
              placeholder={t('details.altPlaceholder')}
              aria-describedby='media-alt-count'
              onChange={(e) => setAlt(e.target.value)}
            />
            <div className='flex items-start gap-3'>
              <p className='text-muted-foreground text-xs'>{t('details.altHint')}</p>
              <CharCounter id='media-alt-count' count={alt.length} max={500} />
            </div>
          </div>
        )}
      </div>
      {scope.canEdit && (
        <SheetFooter className='flex-row justify-between border-t'>
          <Button variant='destructive' onClick={() => setConfirmDelete(true)}>
            <Icons.trash className='size-4' aria-hidden />
            {t('delete')}
          </Button>
          {item.mime_type.startsWith('image/') && (
            <LoadingButton
              loading={updateMediaAlt.isPending}
              disabled={alt === (item.alt_text ?? '')}
              onClick={() =>
                updateMediaAlt.mutate(
                  { id: item.id, altText: alt },
                  {
                    onSuccess: () => {
                      toast.success(t('details.altSaved'));
                      onClose();
                    }
                  }
                )
              }
            >
              {t('details.save')}
            </LoadingButton>
          )}
        </SheetFooter>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <LoadingButton
              variant='destructive'
              loading={deleteMedia.isPending}
              onClick={() =>
                deleteMedia.mutate(item, {
                  onSuccess: () => {
                    toast.success(t('deleted'));
                    setConfirmDelete(false);
                    onClose();
                  }
                })
              }
            >
              {t('delete')}
            </LoadingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
