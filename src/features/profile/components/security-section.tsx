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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { Skeleton } from '@/components/ui/skeleton';
import { signOut } from '@/lib/auth/actions';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { mfaStateQueryOptions, securityKeys } from '../api/queries';
import {
  cancelTotpEnrollment,
  enrollTotp,
  removeFactor,
  signOutEverywhere,
  verifyTotp
} from '../api/service';
import type { MfaFactor, TotpEnrollment } from '../api/types';

const codeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, { message: 'Code à 6 chiffres' })
});

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('fr-FR', { dateStyle: 'medium' });
}

function EnrollTotp({
  enrollment,
  onDone,
  onCancel
}: {
  enrollment: TotpEnrollment;
  onDone: () => void;
  onCancel: () => void;
}) {
  const form = useAppForm({
    defaultValues: { code: '' },
    validators: { onSubmit: codeSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await verifyTotp(createClient(), enrollment.factorId, value.code);
        toast.success('Vérification en deux étapes activée');
        onDone();
      } catch (e) {
        formApi.setFieldValue('code', '');
        toast.error(e instanceof Error ? e.message : 'Vérification impossible.');
      }
    }
  });

  return (
    <div className='space-y-4 rounded-lg border p-4'>
      <ol className='text-muted-foreground list-decimal space-y-1 ps-5 text-sm'>
        <li>
          Ouvrez votre application d’authentification (Google Authenticator, 1Password, Microsoft
          Authenticator…).
        </li>
        <li>Scannez ce QR code ou saisissez la clé manuellement.</li>
        <li>Entrez le code à 6 chiffres affiché pour confirmer.</li>
      </ol>
      <div className='flex flex-col items-center gap-3 sm:flex-row sm:items-start'>
        {/* Data-URL SVG returned by Supabase: next/image adds nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={enrollment.qrCode}
          alt='QR code à scanner avec votre application d’authentification'
          width={176}
          height={176}
          className='size-44 rounded-md border bg-white p-2'
        />
        <div className='min-w-0 space-y-1 text-sm'>
          <p className='font-medium'>Clé de configuration</p>
          <code className='bg-muted block rounded-md px-2 py-1 font-mono text-xs break-all select-all'>
            {enrollment.secret}
          </code>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => {
              void navigator.clipboard
                ?.writeText(enrollment.secret)
                .then(() => toast.success('Clé copiée'));
            }}
          >
            <Icons.copy className='mr-1 size-4' />
            Copier la clé
          </Button>
        </div>
      </div>
      <form
        className='space-y-4'
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.AppField
            name='code'
            children={(field) => <field.OtpField label='Code de vérification' />}
          />
        </FieldGroup>
        <div className='flex flex-wrap gap-2'>
          <form.Subscribe
            selector={(s) => s.isSubmitting}
            children={(submitting) => (
              <LoadingButton type='submit' loading={submitting}>
                Activer
              </LoadingButton>
            )}
          />
          <Button type='button' variant='outline' onClick={onCancel}>
            Annuler
          </Button>
        </div>
      </form>
    </div>
  );
}

export function SecuritySection() {
  const db = createClient();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery(mfaStateQueryOptions(db));
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [toRemove, setToRemove] = useState<MfaFactor | null>(null);
  const [confirmGlobal, setConfirmGlobal] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: securityKeys.all });
    router.refresh();
  };

  const enrollMutation = useMutation({
    mutationFn: () => enrollTotp(db),
    onSuccess: setEnrollment,
    onError: (e) => toast.error(e.message)
  });

  const removeMutation = useMutation({
    mutationFn: (factorId: string) => removeFactor(db, factorId),
    onSuccess: () => {
      toast.success('Application d’authentification retirée');
      refresh();
    },
    onError: (e) => toast.error(e.message)
  });

  const globalSignOut = useMutation({
    mutationFn: () => signOutEverywhere(db),
    // Then clear the dashboard cookies and go to sign-in (server action).
    onSuccess: () => signOut(),
    onError: (e) => toast.error(e.message)
  });

  const factors = data?.factors ?? [];
  const enabled = factors.length > 0;

  return (
    <Card className='lg:col-span-2'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Icons.shield className='size-5' />
          Sécurité
        </CardTitle>
        <CardDescription>
          Vérification en deux étapes avec une application d’authentification (code à 6 chiffres) et
          gestion de vos sessions.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <section className='space-y-3'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div className='flex items-center gap-2'>
              <h3 className='text-sm font-medium'>Vérification en deux étapes</h3>
              {!isPending &&
                (enabled ? (
                  <Badge>Activée</Badge>
                ) : (
                  <Badge variant='destructive'>Désactivée</Badge>
                ))}
            </div>
            {!enrollment && !isPending && (
              <LoadingButton
                type='button'
                variant={enabled ? 'outline' : 'default'}
                loading={enrollMutation.isPending}
                onClick={() => enrollMutation.mutate()}
              >
                <Icons.add className='mr-1 size-4' />
                {enabled ? 'Ajouter une application' : 'Activer'}
              </LoadingButton>
            )}
          </div>

          {isPending && <Skeleton className='h-12 w-full' />}
          {isError && (
            <p className='text-destructive text-sm'>Impossible de charger la sécurité du compte.</p>
          )}

          {enrollment && (
            <EnrollTotp
              enrollment={enrollment}
              onDone={() => {
                setEnrollment(null);
                refresh();
              }}
              onCancel={() => {
                void cancelTotpEnrollment(db, enrollment.factorId);
                setEnrollment(null);
              }}
            />
          )}

          {factors.length > 0 && (
            <ul className='divide-y rounded-lg border'>
              {factors.map((factor) => (
                <li key={factor.id} className='flex items-center justify-between gap-3 p-3'>
                  <div className='flex min-w-0 items-center gap-3'>
                    <Icons.shieldCheck className='text-primary size-5 shrink-0' />
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium'>
                        {factor.friendlyName || 'Application d’authentification'}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        Ajoutée le {formatDate(factor.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    disabled={removeMutation.isPending}
                    onClick={() => setToRemove(factor)}
                  >
                    <Icons.trash className='mr-1 size-4' />
                    Retirer
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {!isPending && !enabled && !enrollment && (
            <p className='text-muted-foreground text-sm'>
              Protégez votre compte : même avec votre mot de passe, personne ne pourra se connecter
              sans le code de votre téléphone.
            </p>
          )}
        </section>

        <section className='flex flex-wrap items-center justify-between gap-3 border-t pt-4'>
          <div>
            <h3 className='text-sm font-medium'>Sessions</h3>
            <p className='text-muted-foreground text-sm'>
              Déconnecte ce compte sur tous vos appareils et toutes les applications LevelUp.
            </p>
          </div>
          <LoadingButton
            type='button'
            variant='outline'
            loading={globalSignOut.isPending}
            onClick={() => setConfirmGlobal(true)}
          >
            <Icons.devices className='mr-1 size-4' />
            Déconnecter tous mes appareils
          </LoadingButton>
        </section>
      </CardContent>

      <AlertDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer cette application ?</AlertDialogTitle>
            <AlertDialogDescription>
              {factors.length > 1
                ? 'Elle ne pourra plus servir à confirmer vos connexions.'
                : 'C’est votre seule application : la vérification en deux étapes sera désactivée.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                if (toRemove) removeMutation.mutate(toRemove.id);
                setToRemove(null);
              }}
            >
              Retirer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmGlobal} onOpenChange={setConfirmGlobal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Déconnecter tous vos appareils ?</AlertDialogTitle>
            <AlertDialogDescription>
              Toutes vos sessions seront fermées, y compris celle-ci. Vous devrez vous reconnecter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                setConfirmGlobal(false);
                globalSignOut.mutate();
              }}
            >
              Tout déconnecter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
