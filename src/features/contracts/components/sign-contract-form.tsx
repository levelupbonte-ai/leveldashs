'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { useFields } from '@/lib/validation/use-fields';
import { Icons } from '@/components/icons';
import { MfaStepNotice } from '@/components/mfa-step-notice';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { useErrorMessage } from '@/hooks/use-error-message';
import { AppError } from '@/lib/errors';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { contractKeys } from '../api/queries';
import { finalizeContract, signContract } from '../api/service';
import type { Contract, FinalizeResult } from '../api/types';
import { SignaturePad } from './signature-pad';

interface SignContractFormProps {
  contract: Contract;
  defaultName: string;
  onStart: () => void;
  onSigned: (result: FinalizeResult) => void;
}

export function SignContractForm({
  contract,
  defaultName,
  onStart,
  onSigned
}: SignContractFormProps) {
  const t = useTranslations('contract.sign');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [needsMfa, setNeedsMfa] = useState(false);

  const f = useFields();
  const schema = useMemo(
    () =>
      z.object({
        fullName: f.text(120).refine((v) => v.length >= 2, { message: tv('nameRequired') }),
        title: f.text(120).min(1, { message: t('titleRequired') }),
        consent: z.boolean().refine((v) => v, { message: t('consentRequired') }),
        // SVG path of the signature pad: `M`/`L` + integers only (same rule as the database).
        drawnSignature: z
          .string()
          .max(60_000)
          .regex(/^[ML0-9 -]+$/)
          .nullable()
      }),
    [t, tv, f]
  );

  const form = useAppForm({
    defaultValues: {
      fullName: defaultName,
      title: '',
      consent: false,
      drawnSignature: null as string | null
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value: raw }) => {
      const value = schema.parse(raw);
      setNeedsMfa(false);
      const db = createClient();
      try {
        await signContract(db, {
          contractId: contract.id,
          fullName: value.fullName.trim(),
          title: value.title.trim(),
          drawnSignature: value.drawnSignature,
          consent: value.consent,
          documentHash: contract.documentHash ?? ''
        });
      } catch (error) {
        if (error instanceof AppError && error.code === 'mfaRequired') {
          setNeedsMfa(true);
          return;
        }
        if (error instanceof AppError && error.code === 'contractChanged') {
          void queryClient.invalidateQueries({ queryKey: contractKeys.all });
        }
        toast.error(errorMessage(error, 'signFailed'));
        return;
      }
      const result = await finalizeContract(contract.id);
      await queryClient.invalidateQueries({ queryKey: contractKeys.all });
      // The layout session (gate, navigation) is read on the server.
      router.refresh();
      onSigned(result);
    }
  });

  return (
    <Card className='gap-5' onFocusCapture={onStart}>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Icons.signature className='text-primary size-5' aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className='space-y-5'
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup className='grid gap-4 sm:grid-cols-2'>
            <form.AppField
              name='fullName'
              children={(field) => (
                <field.TextField
                  label={t('fullName')}
                  autoComplete='name'
                  required
                  maxLength={120}
                />
              )}
            />
            <form.AppField
              name='title'
              children={(field) => (
                <field.TextField
                  label={t('signerTitle')}
                  placeholder={t('signerTitlePlaceholder')}
                  autoComplete='organization-title'
                  required
                  maxLength={120}
                />
              )}
            />
          </FieldGroup>
          <form.Field
            name='drawnSignature'
            children={(field) => (
              <Field>
                <FieldLabel htmlFor='drawn-signature'>{t('draw')}</FieldLabel>
                <FieldDescription>{t('drawDescription')}</FieldDescription>
                <SignaturePad
                  id='drawn-signature'
                  value={field.state.value}
                  onChange={(path) => field.handleChange(path)}
                />
              </Field>
            )}
          />
          <div className='bg-muted/40 space-y-3 rounded-lg border p-4'>
            <form.AppField
              name='consent'
              children={(field) => <field.CheckboxField label={t('consent')} />}
            />
            <p className='text-muted-foreground text-xs leading-relaxed'>{t('legal')}</p>
          </div>
          {needsMfa && <MfaStepNotice />}
          <form.AppForm>
            <form.SubmitButton className='w-full sm:w-auto'>
              <Icons.signature className='size-4' aria-hidden />
              {t('submit')}
            </form.SubmitButton>
          </form.AppForm>
        </form>
      </CardContent>
    </Card>
  );
}
