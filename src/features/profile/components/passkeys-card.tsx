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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePasskeySupport } from '@/lib/auth/passkey';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { passkeysQueryOptions, securityKeys } from '../api/queries';
import { PasskeyCancelledError, addPasskey, deletePasskey, renamePasskey } from '../api/service';
import type { Passkey } from '../api/types';

const nameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Un nom' })
    .max(120, { message: '120 caractères maximum' })
});

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('fr-FR', { dateStyle: 'medium' });
}

function RenamePasskeyDialog({
  passkey,
  onClose
}: {
  passkey: Passkey | null;
  onClose: () => void;
}) {
  const db = createClient();
  const queryClient = useQueryClient();
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renamePasskey(db, id, name),
    onSuccess: () => {
      toast.success('Passkey renommée');
      void queryClient.invalidateQueries({ queryKey: securityKeys.passkeys() });
      onClose();
    },
    onError: (e) => toast.error(e.message)
  });

  const form = useAppForm({
    defaultValues: { name: passkey?.friendlyName ?? '' },
    validators: { onSubmit: nameSchema },
    onSubmit: async ({ value }) => {
      if (!passkey) return;
      await renameMutation.mutateAsync({
        id: passkey.id,
        name: value.name.trim()
      });
    }
  });

  return (
    <Dialog open={!!passkey} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renommer la passkey</DialogTitle>
          <DialogDescription>
            Un nom pour la reconnaître (ex. « iPhone », « MacBook »).
          </DialogDescription>
        </DialogHeader>
        <form
          id='rename-passkey-form'
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.AppField
              name='name'
              children={(field) => <field.TextField label='Nom' maxLength={120} />}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={onClose}>
            Annuler
          </Button>
          <LoadingButton
            type='submit'
            form='rename-passkey-form'
            loading={renameMutation.isPending}
          >
            Enregistrer
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Passkeys of the account: list, add (browser prompt), rename, delete. */
export function PasskeysCard() {
  const db = createClient();
  const queryClient = useQueryClient();
  const supported = usePasskeySupport();
  const { data, isPending, isError } = useQuery(passkeysQueryOptions(db));
  const [toRename, setToRename] = useState<Passkey | null>(null);
  const [toDelete, setToDelete] = useState<Passkey | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: securityKeys.passkeys() });

  const addMutation = useMutation({
    mutationFn: () => addPasskey(db),
    onSuccess: () => {
      toast.success('Passkey ajoutée');
      void invalidate();
    },
    onError: (e) => {
      if (e instanceof PasskeyCancelledError) return;
      toast.error(e.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePasskey(db, id),
    onSuccess: () => {
      toast.success('Passkey supprimée');
      void invalidate();
    },
    onError: (e) => toast.error(e.message)
  });

  const passkeys = data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='space-y-1.5'>
            <CardTitle className='flex items-center gap-2'>
              <Icons.passkey className='size-5' />
              Passkeys
            </CardTitle>
            <CardDescription>
              Connectez-vous sans mot de passe avec Face ID, Touch ID, Windows Hello ou le code de
              votre téléphone.
            </CardDescription>
          </div>
          {supported && (
            <LoadingButton
              type='button'
              variant='outline'
              loading={addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              <Icons.add className='mr-1 size-4' />
              Ajouter une passkey
            </LoadingButton>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-3'>
        {!supported && (
          <p className='text-muted-foreground text-sm'>
            Ce navigateur ne prend pas en charge les passkeys.
          </p>
        )}
        {isPending && <Skeleton className='h-12 w-full' />}
        {isError && <p className='text-destructive text-sm'>Impossible de charger vos passkeys.</p>}
        {!isPending && !isError && passkeys.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            Aucune passkey pour l’instant. Ajoutez-en une sur chaque appareil que vous utilisez.
          </p>
        )}
        {passkeys.length > 0 && (
          <ul className='divide-y rounded-lg border'>
            {passkeys.map((passkey) => (
              <li
                key={passkey.id}
                className='flex flex-wrap items-center justify-between gap-3 p-3'
              >
                <div className='flex min-w-0 items-center gap-3'>
                  <Icons.passkey className='text-primary size-5 shrink-0' />
                  <div className='min-w-0'>
                    <p className='truncate text-sm font-medium'>
                      {passkey.friendlyName || 'Passkey'}
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      Ajoutée le {formatDate(passkey.createdAt)}
                      {passkey.lastUsedAt
                        ? ` · utilisée le ${formatDate(passkey.lastUsedAt)}`
                        : ' · jamais utilisée'}
                    </p>
                  </div>
                </div>
                <div className='flex gap-1'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={() => setToRename(passkey)}
                  >
                    <Icons.edit className='mr-1 size-4' />
                    Renommer
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    disabled={deleteMutation.isPending}
                    onClick={() => setToDelete(passkey)}
                  >
                    <Icons.trash className='mr-1 size-4' />
                    Supprimer
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <RenamePasskeyDialog
        key={toRename?.id ?? 'none'}
        passkey={toRename}
        onClose={() => setToRename(null)}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette passkey ?</AlertDialogTitle>
            <AlertDialogDescription>
              Elle ne pourra plus servir à vous connecter. Pensez aussi à la retirer du gestionnaire
              de mots de passe de l’appareil.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                if (toDelete) deleteMutation.mutate(toDelete.id);
                setToDelete(null);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
