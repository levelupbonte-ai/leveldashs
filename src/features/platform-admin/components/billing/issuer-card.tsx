'use client';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { billingKeys } from '@/features/billing/api/queries';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { saveBillingIssuer } from '../../api/billing';
import { adminInsightKeys, billingIssuerQueryOptions } from '../../api/queries';
import type { BillingIssuer } from '../../api/types';

/** Shown to staff until LevelUp's legal name, address and e-mail are filled in. */
export function IssuerWarning({ className }: { className?: string }) {
  const t = useTranslations('admin.billing.issuer');
  return (
    <div
      role='alert'
      className={cn(
        'flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm',
        className
      )}
    >
      <Icons.warning
        className='mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300'
        aria-hidden
      />
      <div>
        <p className='font-medium'>{t('warning')}</p>
        <p className='text-muted-foreground'>{t('warningHint')}</p>
      </div>
    </div>
  );
}

/** Staff: LevelUp's business details printed on every invoice and receipt. */
export function IssuerDetailsCard() {
  const { data } = useSuspenseQuery(billingIssuerQueryOptions(createClient()));
  const t = useTranslations('admin.billing.issuer');
  return (
    <Card id='business-details'>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {data.ready ? (
          <p className='flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400'>
            <Icons.check className='size-4' aria-hidden />
            {t('ready')}
          </p>
        ) : (
          <IssuerWarning />
        )}
        <IssuerForm key={data.updated_at ?? 'new'} issuer={data} />
      </CardContent>
    </Card>
  );
}

function IssuerForm({ issuer }: { issuer: BillingIssuer }) {
  const t = useTranslations('admin.billing.issuer');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [year] = useState(() => new Date().getFullYear());
  const schema = useMemo(
    () =>
      z.object({
        legalName: z
          .string()
          .trim()
          .max(200, { message: tv('maxLength', { max: 200 }) }),
        address: z
          .string()
          .trim()
          .max(500, { message: tv('maxLength', { max: 500 }) }),
        email: z
          .string()
          .trim()
          .max(254)
          .refine((v) => v === '' || z.email().safeParse(v).success, { message: tv('email') }),
        taxId: z
          .string()
          .trim()
          .max(80, { message: tv('maxLength', { max: 80 }) })
      }),
    [tv]
  );
  const form = useAppForm({
    defaultValues: {
      legalName: issuer.legal_name ?? '',
      address: issuer.address ?? '',
      email: issuer.email ?? '',
      taxId: issuer.tax_id ?? ''
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        const saved = await saveBillingIssuer(createClient(), value);
        queryClient.setQueryData(adminInsightKeys.issuer(), saved);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: adminInsightKeys.billing() }),
          queryClient.invalidateQueries({ queryKey: billingKeys.all })
        ]);
        toast.success(t('saved'));
      } catch (e) {
        toast.error(errorMessage(e, 'saveFailed'));
      }
    }
  });

  return (
    <form
      className='space-y-4'
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <div className='grid gap-4 sm:grid-cols-2'>
          <form.AppField
            name='legalName'
            children={(field) => (
              <field.TextField label={t('legalName')} maxLength={200} autoComplete='organization' />
            )}
          />
          <form.AppField
            name='email'
            children={(field) => (
              <field.TextField
                label={t('email')}
                type='email'
                maxLength={254}
                autoComplete='email'
              />
            )}
          />
        </div>
        <form.AppField
          name='address'
          children={(field) => (
            <field.TextareaField
              label={t('address')}
              description={t('addressHint')}
              rows={3}
              maxLength={500}
            />
          )}
        />
        <form.AppField
          name='taxId'
          children={(field) => <field.TextField label={t('taxId')} maxLength={80} />}
        />
      </FieldGroup>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <p className='text-muted-foreground text-xs'>
          {t('numbering', {
            prefix: issuer.invoice_prefix,
            year
          })}
        </p>
        <form.AppForm>
          <form.SubmitButton>{t('save')}</form.SubmitButton>
        </form.AppForm>
      </div>
    </form>
  );
}
