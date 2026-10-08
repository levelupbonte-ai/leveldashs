'use client';
import { FieldGroup } from '@/components/ui/field';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';

const schema = z
  .object({
    password: z
      .string()
      .min(10, { message: '10 caractères minimum' })
      .max(72, { message: '72 caractères maximum' }),
    confirm: z.string()
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Les deux mots de passe ne correspondent pas',
    path: ['confirm']
  });

const ERRORS: Record<string, string> = {
  same_password: 'Choisissez un mot de passe différent de l’ancien.',
  weak_password: 'Mot de passe trop faible : choisissez-en un plus long et moins courant.'
};

export default function ResetPasswordForm() {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { password: '', confirm: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setNotice(null);
      const { error } = await createClient().auth.updateUser({
        password: value.password
      });
      if (error) {
        setNotice(ERRORS[error.code ?? ''] ?? 'Modification impossible. Demandez un nouveau lien.');
        return;
      }
      toast.success('Mot de passe mis à jour.');
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
            <field.TextField
              label='Nouveau mot de passe'
              type='password'
              autoComplete='new-password'
            />
          )}
        />
        <form.AppField
          name='confirm'
          children={(field) => (
            <field.TextField label='Confirmer' type='password' autoComplete='new-password' />
          )}
        />
      </FieldGroup>
      {notice && (
        <p role='status' className='text-muted-foreground text-sm'>
          {notice}
        </p>
      )}
      <form.AppForm>
        <form.SubmitButton className='mt-2 w-full'>Enregistrer le mot de passe</form.SubmitButton>
      </form.AppForm>
    </form>
  );
}
