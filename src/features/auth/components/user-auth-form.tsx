'use client';
import { Icons } from '@/components/icons';
import { Button, buttonVariants } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { isExternalNext, safeNext } from '@/lib/auth/redirect';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { AuthSteps } from './auth-steps';
import { SignupEmailSent } from './signup-email-sent';
import { TurnstileWidget, useCaptcha } from './turnstile';

const signInSchema = z.object({
  fullName: z.string(),
  email: z.string().email({ message: 'Adresse e-mail invalide' }),
  password: z.string().min(1, { message: 'Mot de passe requis' })
});

const signUpSchema = signInSchema.extend({
  fullName: z.string().trim().min(2, { message: 'Votre nom' }).max(120),
  password: z
    .string()
    .min(10, { message: '10 caractères minimum' })
    .max(72, { message: '72 caractères maximum' })
});

// Google sign-in shows only once the provider is enabled in Supabase Auth.
const GOOGLE_AUTH_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH === 'on';

const CAPTCHA_NOTICE = 'Confirmez que vous n’êtes pas un robot (vérification ci-dessus).';

function callbackUrl(next: string) {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export default function UserAuthForm({
  mode,
  next,
  initialError
}: {
  mode: 'sign-in' | 'sign-up';
  next?: string;
  initialError?: string;
}) {
  const router = useRouter();
  const destination = safeNext(next);

  // Another LevelUp app (LevelStudio, main site) gets a full page load.
  function goTo(target: string) {
    if (isExternalNext(target)) {
      window.location.assign(target);
      return;
    }
    router.replace(target);
    router.refresh();
  }
  const captcha = useCaptcha();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    initialError ? 'La connexion a échoué. Réessayez.' : null
  );
  // Sign-up waiting for the e-mail link. The password stays in memory (React
  // state only, never stored) so this tab can sign in once the link is clicked,
  // even on another device.
  const [sent, setSent] = useState<{ email: string; password: string } | null>(null);
  // After the e-mail check, a new account finishes its profile (and, for the
  // dashboard, asks for access); other LevelUp apps get the visitor back after.
  const onboardingUrl = `/auth/onboarding?next=${encodeURIComponent(destination)}`;
  // The link itself opens a "congratulations" page (/auth/verified), which says
  // to go back to the first device or to continue on this one.
  const signUpRedirect = () =>
    callbackUrl(`/auth/verified?next=${encodeURIComponent(onboardingUrl)}`);

  const form = useAppForm({
    defaultValues: { fullName: '', email: '', password: '' },
    validators: { onSubmit: mode === 'sign-up' ? signUpSchema : signInSchema },
    onSubmit: async ({ value }) => {
      if (!captcha.ready) {
        setNotice(CAPTCHA_NOTICE);
        return;
      }
      setPending(true);
      setNotice(null);
      const supabase = createClient();
      try {
        if (mode === 'sign-in') {
          const { error } = await supabase.auth.signInWithPassword({
            email: value.email,
            password: value.password,
            options: { captchaToken: captcha.captchaToken }
          });
          if (error) {
            setNotice(
              error.code === 'email_not_confirmed'
                ? 'Confirmez votre adresse e-mail (lien reçu par e-mail) puis reconnectez-vous.'
                : 'E-mail ou mot de passe incorrect.'
            );
            return;
          }
          // A verified authenticator app: the second factor comes next.
          if (await needsMfaChallenge(supabase)) {
            router.replace(mfaChallengeUrl(destination));
            return;
          }
          goTo(destination);
        } else {
          const { data, error } = await supabase.auth.signUp({
            email: value.email,
            password: value.password,
            options: {
              data: { full_name: value.fullName.trim() },
              emailRedirectTo: signUpRedirect(),
              captchaToken: captcha.captchaToken
            }
          });
          if (error) {
            setNotice(
              error.code === 'weak_password'
                ? 'Mot de passe trop faible : choisissez-en un plus long.'
                : 'Inscription impossible. Vérifiez vos informations.'
            );
            return;
          }
          if (data.session) {
            goTo(onboardingUrl);
          } else {
            setSent({ email: value.email, password: value.password });
          }
        }
      } finally {
        captcha.reset();
        setPending(false);
      }
    }
  });

  async function signInWithGoogle() {
    setPending(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl(destination) }
    });
    if (error) {
      setPending(false);
      toast.error('Connexion Google indisponible pour le moment.');
    }
  }

  async function resend(captchaToken: string | undefined) {
    if (!sent) return;
    await createClient().auth.resend({
      type: 'signup',
      email: sent.email,
      options: { emailRedirectTo: signUpRedirect(), captchaToken }
    });
  }

  if (sent) {
    return (
      <SignupEmailSent
        email={sent.email}
        password={sent.password}
        onResend={resend}
        onChangeEmail={() => setSent(null)}
        onVerified={() => router.replace(onboardingUrl)}
      />
    );
  }

  return (
    <div className='space-y-4'>
      {mode === 'sign-up' && <AuthSteps current={0} />}
      {GOOGLE_AUTH_ENABLED && (
        <>
          {/* Google Sign-In branding: white button, official multicolor G, grey border. */}
          <Button
            className='h-11 w-full gap-3 border-[#747775] bg-white text-[15px] font-medium text-[#1F1F1F] shadow-sm hover:bg-[#F8F9FA] hover:text-[#1F1F1F] dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3] dark:hover:bg-[#1E1F20] dark:hover:text-[#E3E3E3]'
            variant='outline'
            type='button'
            disabled={pending}
            onClick={signInWithGoogle}
          >
            <Icons.googleColor size={20} />
            Continuer avec Google
          </Button>
          <div className='relative'>
            <div className='absolute inset-0 flex items-center'>
              <span className='w-full border-t' />
            </div>
            <div className='relative flex justify-center text-xs uppercase'>
              <span className='bg-background text-muted-foreground px-2'>ou par e-mail</span>
            </div>
          </div>
        </>
      )}
      <form
        className='w-full space-y-2'
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <FieldGroup>
          {mode === 'sign-up' && (
            <form.AppField
              name='fullName'
              children={(field) => (
                <field.TextField label='Nom complet' autoComplete='name' disabled={pending} />
              )}
            />
          )}
          <form.AppField
            name='email'
            children={(field) => (
              <field.TextField
                label='E-mail'
                type='email'
                autoComplete='email'
                placeholder='vous@exemple.com'
                disabled={pending}
              />
            )}
          />
          <form.AppField
            name='password'
            children={(field) => (
              <field.TextField
                label='Mot de passe'
                type='password'
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                disabled={pending}
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
        <LoadingButton loading={pending} type='submit' className='mt-2 w-full'>
          {mode === 'sign-in' ? 'Se connecter' : 'Créer mon compte'}
        </LoadingButton>
        {mode === 'sign-in' && (
          <Link
            href='/auth/forgot-password'
            className={buttonVariants({
              variant: 'link',
              className: 'text-muted-foreground w-full'
            })}
          >
            Mot de passe oublié ?
          </Link>
        )}
        {mode === 'sign-in' && (
          <p className='text-muted-foreground text-center text-xs text-balance'>
            <Icons.shieldCheck className='mr-1 inline size-3.5 align-[-2px]' aria-hidden />
            Protégé par la double authentification (application d’authentification)
          </p>
        )}
      </form>
    </div>
  );
}
