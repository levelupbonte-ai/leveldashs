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
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useErrorMessage } from '@/hooks/use-error-message';
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

function EnrollTotp({
  enrollment,
  onDone,
  onCancel
}: {
  enrollment: TotpEnrollment;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('profile.security');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const codeSchema = useMemo(
    () => z.object({ code: z.string().regex(/^\d{6}$/, { message: tv('code') }) }),
    [tv]
  );
  const form = useAppForm({
    defaultValues: { code: '' },
    validators: { onSubmit: codeSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await verifyTotp(createClient(), enrollment.factorId, value.code);
        toast.success(t('enabledToast'));
        onDone();
      } catch (e) {
        formApi.setFieldValue('code', '');
        toast.error(errorMessage(e, 'mfaVerifyFailed'));
      }
    }
  });

  return (
    <div className='space-y-4 rounded-lg border p-4'>
      <ol className='text-muted-foreground list-decimal space-y-1 ps-5 text-sm'>
        <li>{t('step1')}</li>
        <li>{t('step2')}</li>
        <li>{t('step3')}</li>
      </ol>
      <div className='flex flex-col items-center gap-3 sm:flex-row sm:items-start'>
        {/* Data-URL SVG returned by Supabase: next/image adds nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={enrollment.qrCode}
          alt={t('qrAlt')}
          width={176}
          height={176}
          className='size-44 rounded-md border bg-white p-2'
        />
        <div className='min-w-0 space-y-1 text-sm'>
          <p className='font-medium'>{t('setupKey')}</p>
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
                .then(() => toast.success(t('keyCopied')));
            }}
          >
            <Icons.copy className='mr-1 size-4' />
            {t('copyKey')}
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
            children={(field) => <field.OtpField label={t('codeLabel')} />}
          />
        </FieldGroup>
        <div className='flex flex-wrap gap-2'>
          <form.Subscribe
            selector={(s) => s.isSubmitting}
            children={(submitting) => (
              <LoadingButton type='submit' loading={submitting}>
                {t('enable')}
              </LoadingButton>
            )}
          />
          <Button type='button' variant='outline' onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function SecuritySection() {
  const t = useTranslations('profile.security');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const formatDate = (value: string) => format.dateTime(new Date(value), { dateStyle: 'medium' });
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
    mutationFn: () =>
      enrollTotp(
        db,
        t('factorName', {
          date: format.dateTime(new Date(), { dateStyle: 'short', timeStyle: 'short' })
        })
      ),
    onSuccess: setEnrollment,
    onError: (e) => toast.error(errorMessage(e))
  });

  const removeMutation = useMutation({
    mutationFn: (factorId: string) => removeFactor(db, factorId),
    onSuccess: () => {
      toast.success(t('removedToast'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e))
  });

  const globalSignOut = useMutation({
    mutationFn: () => signOutEverywhere(db),
    // Then clear the dashboard cookies and go to sign-in (server action).
    onSuccess: () => signOut(),
    onError: (e) => toast.error(errorMessage(e))
  });

  const factors = data?.factors ?? [];
  const enabled = factors.length > 0;

  return (
    <Card className='lg:col-span-2'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Icons.shield className='size-5' />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <section className='space-y-3'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div className='flex items-center gap-2'>
              <h3 className='text-sm font-medium'>{t('twoStep')}</h3>
              {!isPending &&
                (enabled ? (
                  <Badge>{t('on')}</Badge>
                ) : (
                  <Badge variant='secondary'>{t('off')}</Badge>
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
                {enabled ? t('addApp') : t('setUp')}
              </LoadingButton>
            )}
          </div>

          {isPending && <Skeleton className='h-12 w-full' />}
          {isError && <p className='text-muted-foreground text-sm'>{t('loadFailed')}</p>}

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
                        {factor.friendlyName || t('app')}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {t('addedOn', { date: formatDate(factor.createdAt) })}
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
                    {t('remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {!isPending && !enabled && !enrollment && (
            <p className='text-muted-foreground text-sm'>{t('offHint')}</p>
          )}
        </section>

        <section className='flex flex-wrap items-center justify-between gap-3 border-t pt-4'>
          <div>
            <h3 className='text-sm font-medium'>{t('sessions')}</h3>
            <p className='text-muted-foreground text-sm'>{t('sessionsHint')}</p>
          </div>
          <LoadingButton
            type='button'
            variant='outline'
            loading={globalSignOut.isPending}
            onClick={() => setConfirmGlobal(true)}
          >
            <Icons.devices className='mr-1 size-4' />
            {t('signOutAll')}
          </LoadingButton>
        </section>
      </CardContent>

      <AlertDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {factors.length > 1 ? t('removeOther') : t('removeLast')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                if (toRemove) removeMutation.mutate(toRemove.id);
                setToRemove(null);
              }}
            >
              {t('remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmGlobal} onOpenChange={setConfirmGlobal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('signOutAllTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('signOutAllDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                setConfirmGlobal(false);
                globalSignOut.mutate();
              }}
            >
              {t('signOutAllConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
