'use client';
import { FieldGroup } from '@/components/ui/field';
import { commonPasswordValidator } from '@/lib/auth/password-check';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';

export default function ResetPasswordForm() {
  const router = useRouter();
  const t = useTranslations('auth.reset');
  const tv = useTranslations('validation');
  const schema = useMemo(
    () =>
      z
        .object({
          password: z
            .string()
            .min(10, { message: tv('passwordMin', { min: 10 }) })
            .max(72, { message: tv('passwordMax', { max: 72 }) }),
          confirm: z.string()
        })
        .refine((v) => v.password === v.confirm, {
          message: tv('passwordsMatch'),
          path: ['confirm']
        }),
    [tv]
  );
  const [notice, setNotice] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { password: '', confirm: '' },
    validators: {
      onSubmit: schema,
      onSubmitAsync: commonPasswordValidator(tv('commonPassword'))
    },
    onSubmit: async ({ value }) => {
      setNotice(null);
      const { error } = await createClient().auth.updateUser({
        password: value.password
      });
      if (error) {
        setNotice(
          error.code === 'same_password'
            ? t('samePassword')
            : error.code === 'weak_password'
              ? t('weakPassword')
              : t('failed')
        );
        return;
      }
      toast.success(t('updated'));
      router.replace('/dashboard/site');
      router.refresh();
    }
  });

  return (
    <form
      className='w-full space-y-2'
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.AppField
          name='password'
          children={(field) => (
            <field.TextField label={t('newPassword')} type='password' autoComplete='new-password' />
          )}
        />
        <form.AppField
          name='confirm'
          children={(field) => (
            <field.TextField label={t('confirm')} type='password' autoComplete='new-password' />
          )}
        />
      </FieldGroup>
      {notice && (
        <p role='status' className='text-muted-foreground text-sm'>
          {notice}
        </p>
      )}
      <form.AppForm>
        <form.SubmitButton className='mt-2 w-full'>{t('submit')}</form.SubmitButton>
      </form.AppForm>
    </form>
  );
}
