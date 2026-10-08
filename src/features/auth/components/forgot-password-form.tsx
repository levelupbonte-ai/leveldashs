'use client';
import Link from 'next/link';
import { useState } from 'react';
import * as z from 'zod';
import { FieldGroup } from '@/components/ui/field';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { EmailSent } from './email-sent';
import { TurnstileWidget, useCaptcha } from './turnstile';

const schema = z.object({ email: z.string().trim().email({ message: 'Adresse e-mail invalide' }) });

const redirectTo = () =>
  `${window.location.origin}/auth/callback?next=${encodeURIComponent('/auth/reset-password')}`;

export default function ForgotPasswordForm() {
  const captcha = useCaptcha();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(email: string, captchaToken: string | undefined) {
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo(),
      captchaToken
    });
    // Too many requests is the only error worth telling: the rest would reveal
    // whether an account exists.
    if (error?.status === 429) throw new Error('rate_limited');
  }

  const form = useAppForm({
    defaultValues: { email: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      if (!captcha.ready) {
        setNotice('Confirmez que vous n’êtes pas un robot.');
        return;
      }
      setNotice(null);
      try {
        await send(value.email.trim(), captcha.captchaToken);
        setSentTo(value.email.trim());
      } catch {
        setNotice('Trop de demandes pour le moment. Réessayez dans quelques minutes.');
      } finally {
        captcha.reset();
      }
    }
  });

  if (sentTo) {
    return (
      <EmailSent
        email={sentTo}
        title='Lien envoyé'
        description='Si un compte LevelUp existe pour cette adresse, un lien de réinitialisation vient d’être envoyé à'
        onResend={(token) => send(sentTo, token)}
        onChangeEmail={() => setSentTo(null)}
      />
    );
  }

  return (
    <form
      className='w-full space-y-3'
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.AppField
          name='email'
          children={(field) => (
            <field.TextField
              label='E-mail du compte'
              type='email'
              autoComplete='email'
              placeholder='vous@exemple.com'
            />
          )}
        />
      </FieldGroup>
      <TurnstileWidget {...captcha.widgetProps} />
      {notice && (
        <p role='status' className='text-muted-foreground text-sm'>
          {notice}
        </p>
      )}
      <form.AppForm>
        <form.SubmitButton className='w-full'>Envoyer le lien</form.SubmitButton>
      </form.AppForm>
      <p className='text-muted-foreground text-center text-sm'>
        <Link href='/auth/sign-in' className='hover:text-primary underline underline-offset-4'>
          Retour à la connexion
        </Link>
      </p>
    </form>
  );
}
