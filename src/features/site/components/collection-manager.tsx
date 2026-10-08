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
import { toast } from 'sonner';
import { useSiteMutations } from '../api/mutations';
import { collectionQueryOptions } from '../api/queries';
import type { ContentRow } from '../api/types';
import { getCollection, STATUS_OPTIONS, type CollectionKey } from '../config/collections';
import { ItemSheet } from './item-sheet';
import { useSiteScope } from './use-site-scope';

const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));

export function CollectionManager({ collection }: { collection: CollectionKey }) {
  const def = getCollection(collection)!;
  const scope = useSiteScope();
  const { data: rows } = useSuspenseQuery(
    collectionQueryOptions(createClient(), def, scope.websiteId)
  );
  const { deleteItem } = useSiteMutations(scope);
  const [editing, setEditing] = useState<ContentRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ContentRow | null>(null);
  const [search, setSearch] = useState('');

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

  const openEditor = (row: ContentRow | null) => {
    setEditing(row);
    setSheetOpen(true);
  };

  return (
    <div className='space-y-4'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <Input
          placeholder='Rechercher…'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='sm:max-w-xs'
        />
        {scope.canEdit && (
          <Button onClick={() => openEditor(null)}>
            <Icons.add className='mr-2 size-4' /> Ajouter
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>{rows.length ? 'Aucun résultat' : 'Rien pour le moment'}</EmptyTitle>
            <EmptyDescription>
              {rows.length
                ? 'Essayez une autre recherche.'
                : `Ajoutez votre premier ${def.singular} : il apparaîtra sur votre site une fois publié.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          {filtered.map((row) => {
            const image = def.imageField ? String(row[def.imageField] ?? '') : '';
            const status = String(row.status ?? '');
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
                  <p className='truncate font-medium'>{String(row[def.titleField] ?? '')}</p>
                  {def.subtitleField && def.subtitleField !== 'status' && (
                    <p className='text-muted-foreground truncate text-xs'>
                      {String(row[def.subtitleField] ?? '')}
                    </p>
                  )}
                  {status && status !== 'published' && (
                    <Badge variant='secondary' className='mt-1'>
                      {STATUS_LABEL[status] ?? status}
                    </Badge>
                  )}
                </div>
                <div className='flex shrink-0 gap-1'>
                  <Button
                    size='icon'
                    variant='ghost'
                    aria-label='Modifier'
                    onClick={() => openEditor(row)}
                  >
                    <Icons.edit className='size-4' />
                  </Button>
                  {scope.canEdit && (
                    <Button
                      size='icon'
                      variant='ghost'
                      aria-label='Supprimer'
                      onClick={() => setToDelete(row)}
                    >
                      <Icons.trash className='size-4' />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ItemSheet def={def} item={editing} open={sheetOpen} onOpenChange={setSheetOpen} />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet élément ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {String(toDelete?.[def.titleField] ?? '')} » sera retiré de votre site. Pour le
              masquer sans le supprimer, passez-le en brouillon.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                if (!toDelete) return;
                deleteItem.mutate(
                  { def, id: toDelete.id },
                  { onSuccess: () => toast.success('Supprimé') }
                );
                setToDelete(null);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
