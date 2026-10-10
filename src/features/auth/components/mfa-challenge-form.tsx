'use client';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { isExternalNext, safeNext } from '@/lib/auth/redirect';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import * as z from 'zod';

export default function MfaChallengeForm({ next }: { next?: string }) {
  const router = useRouter();
  const t = useTranslations('auth.mfa');
  const tv = useTranslations('validation');
  const codeSchema = useMemo(
    () => z.object({ code: z.string().regex(/^\d{6}$/, { message: tv('code') }) }),
    [tv]
  );
  const destination = safeNext(next);
  const [notice, setNotice] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Another LevelUp app (LevelStudio, main site) gets a full page load.
  function goTo(target: string) {
    if (isExternalNext(target)) {
      window.location.assign(target);
      return;
    }
    router.replace(target);
    router.refresh();
  }

  const form = useAppForm({
    defaultValues: { code: '' },
    validators: { onSubmit: codeSchema },
    onSubmit: async ({ value, formApi }) => {
      setNotice(null);
      const supabase = createClient();
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp.find((f) => f.status === 'verified');
      if (listError || !factor) {
        setNotice(t('noFactor'));
        return;
      }
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: value.code
      });
      if (error) {
        formApi.setFieldValue('code', '');
        setNotice(
          error.code === 'mfa_verification_failed' || error.code === 'mfa_challenge_expired'
            ? t('wrongCode')
            : t('failed')
        );
        return;
      }
      goTo(destination);
    }
  });

  async function signOut() {
    setSigningOut(true);
    await createClient().auth.signOut();
    router.replace(`/auth/sign-in?next=${encodeURIComponent(destination)}`);
    router.refresh();
  }

  return (
    <form
      className='w-full space-y-4'
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup className='items-center'>
        <form.AppField
          name='code'
          listeners={{
            onChange: ({ value }) => {
              if (/^\d{6}$/.test(value) && !form.state.isSubmitting) form.handleSubmit();
            }
          }}
          children={(field) => <field.OtpField label={t('codeLabel')} />}
        />
      </FieldGroup>
      {notice && (
        <p role='status' className='text-muted-foreground text-center text-sm'>
          {notice}
        </p>
      )}
      <form.Subscribe
        selector={(s) => s.isSubmitting}
        children={(submitting) => (
          <LoadingButton type='submit' loading={submitting} className='w-full'>
            {t('submit')}
          </LoadingButton>
        )}
      />
      <Button
        type='button'
        variant='link'
        className='text-muted-foreground w-full'
        disabled={signingOut}
        onClick={signOut}
      >
        {t('otherAccount')}
      </Button>
      <p className='text-muted-foreground text-center text-xs'>
        {t.rich('lostAccess', {
          email: () => (
            <a
              href='mailto:contact@levelup-ecosystem.com'
              className='hover:text-primary underline underline-offset-4'
            >
              contact@levelup-ecosystem.com
            </a>
          )
        })}
      </p>
    </form>
  );
}
