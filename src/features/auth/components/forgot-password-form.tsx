'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import * as z from 'zod';
import { FieldGroup } from '@/components/ui/field';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { EmailSent } from './email-sent';
import { TurnstileWidget, useCaptcha } from './turnstile';

const redirectTo = () =>
  `${window.location.origin}/auth/callback?next=${encodeURIComponent('/auth/reset-password')}`;

export default function ForgotPasswordForm() {
  const t = useTranslations('auth.forgot');
  const tv = useTranslations('validation');
  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .email({ message: tv('email') })
      }),
    [tv]
  );
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
        setNotice(t('captcha'));
        return;
      }
      setNotice(null);
      try {
        await send(value.email.trim(), captcha.captchaToken);
        setSentTo(value.email.trim());
      } catch {
        setNotice(t('rateLimited'));
      } finally {
        captcha.reset();
      }
    }
  });

  if (sentTo) {
    return (
      <EmailSent
        email={sentTo}
        title={t('sentTitle')}
        description={t('sentDescription')}
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
              label={t('emailLabel')}
              type='email'
              autoComplete='email'
              placeholder={t('emailPlaceholder')}
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
        <form.SubmitButton className='w-full'>{t('submit')}</form.SubmitButton>
      </form.AppForm>
      <p className='text-muted-foreground text-center text-sm'>
        <Link href='/auth/sign-in' className='hover:text-primary underline underline-offset-4'>
          {t('backToSignIn')}
        </Link>
      </p>
    </form>
  );
}
