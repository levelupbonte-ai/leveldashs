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
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useErrorMessage } from '@/hooks/use-error-message';
import { toast } from 'sonner';
import * as z from 'zod';
import { passkeysQueryOptions, securityKeys } from '../api/queries';
import { PasskeyCancelledError, addPasskey, deletePasskey, renamePasskey } from '../api/service';
import type { Passkey } from '../api/types';

function RenamePasskeyDialog({
  passkey,
  onClose
}: {
  passkey: Passkey | null;
  onClose: () => void;
}) {
  const t = useTranslations('profile.passkeys');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const nameSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, { message: tv('nameRequired') })
          .max(120, { message: tv('maxLength', { max: 120 }) })
      }),
    [tv]
  );
  const db = createClient();
  const queryClient = useQueryClient();
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renamePasskey(db, id, name),
    onSuccess: () => {
      toast.success(t('renamed'));
      void queryClient.invalidateQueries({ queryKey: securityKeys.passkeys() });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e))
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
          <DialogTitle>{t('renameTitle')}</DialogTitle>
          <DialogDescription>{t('renameDescription')}</DialogDescription>
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
              children={(field) => <field.TextField label={t('name')} maxLength={120} />}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={onClose}>
            {t('cancel')}
          </Button>
          <LoadingButton
            type='submit'
            form='rename-passkey-form'
            loading={renameMutation.isPending}
          >
            {t('save')}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Passkeys of the account: list, add (browser prompt), rename, delete. */
export function PasskeysCard() {
  const t = useTranslations('profile.passkeys');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const formatDate = (value: string) => format.dateTime(new Date(value), { dateStyle: 'medium' });
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
      toast.success(t('added'));
      void invalidate();
    },
    onError: (e) => {
      if (e instanceof PasskeyCancelledError) return;
      toast.error(errorMessage(e));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePasskey(db, id),
    onSuccess: () => {
      toast.success(t('deleted'));
      void invalidate();
    },
    onError: (e) => toast.error(errorMessage(e))
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
            <CardDescription>{t('description')}</CardDescription>
          </div>
          {supported && (
            <LoadingButton
              type='button'
              variant='outline'
              loading={addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              <Icons.add className='mr-1 size-4' />
              {t('add')}
            </LoadingButton>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-3'>
        {!supported && <p className='text-muted-foreground text-sm'>{t('unsupported')}</p>}
        {isPending && <Skeleton className='h-12 w-full' />}
        {isError && <p className='text-muted-foreground text-sm'>{t('loadFailed')}</p>}
        {!isPending && !isError && passkeys.length === 0 && (
          <p className='text-muted-foreground text-sm'>{t('empty')}</p>
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
                      {t('addedOn', { date: formatDate(passkey.createdAt) })}
                      {' · '}
                      {passkey.lastUsedAt
                        ? t('usedOn', { date: formatDate(passkey.lastUsedAt) })
                        : t('neverUsed')}
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
                    {t('rename')}
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    disabled={deleteMutation.isPending}
                    onClick={() => setToDelete(passkey)}
                  >
                    <Icons.trash className='mr-1 size-4' />
                    {t('delete')}
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
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                if (toDelete) deleteMutation.mutate(toDelete.id);
                setToDelete(null);
              }}
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
