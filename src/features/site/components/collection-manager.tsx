'use client';

import { Icons } from '@/components/icons';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useSiteMutations } from '../api/mutations';
import { collectionQueryOptions } from '../api/queries';
import type { ContentRow } from '../api/types';
import { getCollection, type CollectionKey } from '../config/collections';
import { ItemSheet } from './item-sheet';
import { useCollectionText } from './use-collection-text';
import { useSiteScope } from './use-site-scope';

export function CollectionManager({ collection }: { collection: CollectionKey }) {
  const def = getCollection(collection)!;
  const text = useCollectionText(def);
  const t = useTranslations('site.content');
  const scope = useSiteScope();
  const { data: rows } = useSuspenseQuery(
    collectionQueryOptions(createClient(), def, scope.websiteId)
  );
  const { deleteItem, reorderItems } = useSiteMutations(scope);
  const [editing, setEditing] = useState<ContentRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ContentRow | null>(null);
  const [search, setSearch] = useState('');

  const fieldOf = (name?: string) => def.fields.find((f) => f.name === name);
  const titleField = fieldOf(def.titleField);
  const subtitleField = fieldOf(def.subtitleField);
  const groupField = fieldOf(def.groupBy);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [def.titleField, def.subtitleField].some((k) =>
        k
          ? String(r[k] ?? '')
              .toLowerCase()
              .includes(q)
          : false
      )
    );
  }, [rows, search, def]);

  // Rows split by `groupBy` (e.g. the page of a page section), in list order.
  const groups = useMemo(() => {
    const map = new Map<string, ContentRow[]>();
    for (const row of filtered) {
      const key = def.groupBy ? String(row[def.groupBy] ?? '') : '';
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    // Groups follow the order of the field's options (e.g. Home first).
    const order = (key: string) => groupField?.options?.findIndex((o) => o.value === key) ?? 0;
    return [...map.entries()].toSorted(([a], [b]) => order(a) - order(b));
  }, [filtered, def.groupBy, groupField]);

  const canReorder = def.reorder && scope.canEdit && !search.trim();

  const move = (group: ContentRow[], index: number, to: number) => {
    const next = [...group];
    const [row] = next.splice(index, 1);
    next.splice(to, 0, row);
    reorderItems.mutate(
      {
        def,
        rows: next.map((r) => ({ id: r.id, sort_order: Number(r.sort_order ?? 0) }))
      },
      { onSuccess: () => toast.success(t('orderSaved')) }
    );
  };

  const openEditor = (row: ContentRow | null) => {
    setEditing(row);
    setSheetOpen(true);
  };

  const renderCard = (row: ContentRow, group: ContentRow[], index: number) => {
    const image = def.imageField ? String(row[def.imageField] ?? '') : '';
    const status = String(row.status ?? '');
    const badges = (def.badges ?? []).flatMap((name) => {
      const f = fieldOf(name);
      const label = f ? text.badge(f, row[name]) : null;
      return label ? [{ name, label }] : [];
    });
    return (
      <Card key={row.id} className='flex flex-row items-center gap-3 p-3'>
        {def.imageField && (
          <div className='bg-muted size-14 shrink-0 overflow-hidden rounded-md'>
            {image && (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary storage/remote URLs
              <img src={image} alt='' className='size-full object-cover' loading='lazy' />
            )}
          </div>
        )}
        <div className='min-w-0 flex-1'>
          <p className='truncate font-medium'>{text.display(titleField, row[def.titleField])}</p>
          {def.subtitleField &&
            def.subtitleField !== 'status' &&
            def.subtitleField !== def.groupBy && (
              <p className='text-muted-foreground truncate text-xs'>
                {text.display(subtitleField, row[def.subtitleField])}
              </p>
            )}
          {(badges.length > 0 || (status && status !== 'published') || row.enabled === false) && (
            <div className='mt-1 flex flex-wrap gap-1'>
              {status && status !== 'published' && (
                <Badge variant='secondary'>{text.statusLabel(status)}</Badge>
              )}
              {row.enabled === false && <Badge variant='secondary'>{t('hiddenOnSite')}</Badge>}
              {badges.map((b) => (
                <Badge key={b.name} variant='outline' className='font-normal'>
                  {b.label}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className='flex shrink-0 gap-1'>
          {canReorder && (
            <div className='flex flex-col'>
              <Button
                size='icon'
                variant='ghost'
                className='size-7'
                aria-label={t('moveUp')}
                disabled={index === 0 || reorderItems.isPending}
                onClick={() => move(group, index, index - 1)}
              >
                <Icons.arrowUp className='size-4' />
              </Button>
              <Button
                size='icon'
                variant='ghost'
                className='size-7'
                aria-label={t('moveDown')}
                disabled={index === group.length - 1 || reorderItems.isPending}
                onClick={() => move(group, index, index + 1)}
              >
                <Icons.arrowDown className='size-4' />
              </Button>
            </div>
          )}
          <Button
            size='icon'
            variant='ghost'
            aria-label={t('edit')}
            onClick={() => openEditor(row)}
          >
            <Icons.edit className='size-4' />
          </Button>
          {scope.canEdit && (
            <Button
              size='icon'
              variant='ghost'
              aria-label={t('delete')}
              onClick={() => setToDelete(row)}
            >
              <Icons.trash className='size-4' />
            </Button>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className='space-y-4'>
      {def.liveHint && (
        <p className='bg-muted/60 text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-sm'>
          <Icons.info className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
          <span>
            {t('liveHint')}
            {scope.website.primaryDomain && (
              <>
                {' '}
                <a
                  href={`https://${scope.website.primaryDomain}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-foreground underline underline-offset-4'
                >
                  {t('openSite', { domain: scope.website.primaryDomain })}
                </a>
              </>
            )}
          </span>
        </p>
      )}
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <Input
          placeholder={t('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='sm:max-w-xs'
        />
        {scope.canEdit && (
          <Button onClick={() => openEditor(null)}>
            <Icons.add className='mr-2 size-4' /> {t('add')}
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>{rows.length ? t('noResults') : t('nothingYet')}</EmptyTitle>
            <EmptyDescription>{rows.length ? t('tryAnother') : text.empty}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        groups.map(([key, group]) => (
          <section key={key || 'all'} className='space-y-2'>
            {def.groupBy && (
              <h2 className='text-muted-foreground pt-2 text-sm font-medium'>
                {text.display(groupField, key)}
              </h2>
            )}
            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              {group.map((row, i) => renderCard(row, group, i))}
            </div>
          </section>
        ))
      )}

      <ItemSheet def={def} item={editing} open={sheetOpen} onOpenChange={setSheetOpen} />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', {
                name: text.display(titleField, toDelete?.[def.titleField])
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                if (!toDelete) return;
                deleteItem.mutate(
                  { def, id: toDelete.id },
                  { onSuccess: () => toast.success(t('deleted')) }
                );
                setToDelete(null);
              }}
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
