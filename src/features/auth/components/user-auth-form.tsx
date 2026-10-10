'use client';
import { Icons } from '@/components/icons';
import { Button, buttonVariants } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import type { AuthMethods } from '@/lib/auth/auth-methods';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { passkeyErrorKind, usePasskeySupport } from '@/lib/auth/passkey';
import { commonPasswordValidator } from '@/lib/auth/password-check';
import { hasGoogleIdentity } from '@/lib/auth/identities';
import { isExternalNext, safeNext } from '@/lib/auth/redirect';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { userLocale } from '@/i18n/config';
import { toast } from 'sonner';
import * as z from 'zod';
import { markPendingMethod, saveLastMethod, useLastMethod } from '../lib/last-method';
import { AuthSteps } from './auth-steps';
import { GoogleSignInButton } from './google-sign-in-button';
import { SignupEmailSent } from './signup-email-sent';
import { TurnstileWidget, useCaptcha } from './turnstile';

// Passkey button: outline, full width, 44 px, same height as Google's button.
const PROVIDER_BUTTON =
  'h-11 w-full gap-3 border-[#747775] bg-white text-[15px] font-medium text-[#1F1F1F] shadow-sm hover:bg-[#F8F9FA] hover:text-[#1F1F1F] dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3] dark:hover:bg-[#1E1F20] dark:hover:text-[#E3E3E3]';

function LastUsedBadge() {
  const t = useTranslations('auth.form');
  return (
    <span className='bg-primary text-primary-foreground pointer-events-none absolute -top-2 right-3 rounded-full px-2 py-0.5 text-[10px] leading-none font-medium shadow-sm'>
      {t('lastUsed')}
    </span>
  );
}

function callbackUrl(next: string) {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export default function UserAuthForm({
  mode,
  next,
  initialError,
  methods = { google: false, passkey: false }
}: {
  mode: 'sign-in' | 'sign-up';
  next?: string;
  initialError?: string;
  /** Sign-in methods enabled in Supabase (read server-side from /auth/v1/settings). */
  methods?: AuthMethods;
}) {
  const router = useRouter();
  const destination = safeNext(next);
  const t = useTranslations('auth.form');
  const tv = useTranslations('validation');
  const locale = useLocale();
  const { signInSchema, signUpSchema } = useMemo(() => {
    const signIn = z.object({
      fullName: z.string(),
      email: z.string().email({ message: tv('email') }),
      password: z.string().min(1, { message: tv('passwordRequired') })
    });
    return {
      signInSchema: signIn,
      signUpSchema: signIn.extend({
        fullName: z
          .string()
          .trim()
          .min(2, { message: tv('fullName') })
          .max(120),
        password: z
          .string()
          .min(10, { message: tv('passwordMin', { min: 10 }) })
          .max(72, { message: tv('passwordMax', { max: 72 }) })
      })
    };
  }, [tv]);

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
  const passkeySupported = usePasskeySupport();
  // Turned off when Supabase answers `passkey_disabled` (settings changed since the page loaded).
  const [passkeyDisabled, setPasskeyDisabled] = useState(false);
  const showPasskey = mode === 'sign-in' && methods.passkey && passkeySupported && !passkeyDisabled;
  // Already a Google account (session in this browser): never offer Google again.
  const [googleLinked, setGoogleLinked] = useState(false);
  useEffect(() => {
    let active = true;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (active && hasGoogleIdentity(data.session?.user)) setGoogleLinked(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const showGoogle = methods.google && !googleLinked;
  // Sign-in only: the method used last time in this browser comes first and the
  // others fold behind "Other sign-in options".
  const lastMethod = useLastMethod();
  const [showAll, setShowAll] = useState(false);
  const preferred =
    mode === 'sign-in' && !showAll
      ? lastMethod === 'google' && showGoogle
        ? 'google'
        : lastMethod === 'passkey' && showPasskey
          ? 'passkey'
          : null
      : null;
  const [notice, setNotice] = useState<string | null>(initialError ? t('callbackFailed') : null);
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
    validators: {
      onSubmit: mode === 'sign-up' ? signUpSchema : signInSchema,
      // New passwords only: refuse very common ones (runs once the schema passes).
      onSubmitAsync: mode === 'sign-up' ? commonPasswordValidator(tv('commonPassword')) : undefined
    },
    onSubmit: async ({ value }) => {
      if (!captcha.ready) {
        setNotice(t('captcha'));
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
              error.code === 'email_not_confirmed' ? t('emailNotConfirmed') : t('wrongCredentials')
            );
            return;
          }
          saveLastMethod('password');
          await afterSignIn(supabase);
        } else {
          const { data, error } = await supabase.auth.signUp({
            email: value.email,
            password: value.password,
            options: {
              // The language of the sign-up, for LevelUp's e-mails (confirmation first).
              data: { full_name: value.fullName.trim(), locale },
              emailRedirectTo: signUpRedirect(),
              captchaToken: captcha.captchaToken
            }
          });
          if (error) {
            setNotice(error.code === 'weak_password' ? t('weakPassword') : t('signUpFailed'));
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

  // Same path for every sign-in method: second factor first, then the destination
  // (the dashboard layout sends accounts without access to onboarding).
  async function afterSignIn(supabase: ReturnType<typeof createClient>) {
    // Keep the language in use on the account when none was chosen yet.
    const { data } = await supabase.auth.getUser();
    if (data.user && !userLocale(data.user)) {
      void supabase.auth.updateUser({ data: { locale } }).catch(() => undefined);
    }
    // A verified authenticator app: the second factor comes next.
    if (await needsMfaChallenge(supabase)) {
      router.replace(mfaChallengeUrl(destination));
      return;
    }
    goTo(destination);
  }

  async function signInWithPasskey() {
    if (!captcha.ready) {
      setNotice(t('captcha'));
      return;
    }
    setPending(true);
    setNotice(null);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signInWithPasskey({
        options: { captchaToken: captcha.captchaToken }
      });
      if (error) {
        switch (passkeyErrorKind(error)) {
          case 'cancelled':
            return;
          case 'disabled':
            setPasskeyDisabled(true);
            return;
          case 'not_found':
            setNotice(t('passkeyNotFound'));
            return;
          case 'email_not_confirmed':
            setNotice(t('emailNotConfirmed'));
            return;
          default:
            setNotice(t('passkeyFailed'));
            return;
        }
      }
      saveLastMethod('passkey');
      await afterSignIn(supabase);
    } finally {
      captcha.reset();
      setPending(false);
    }
  }

  // Google Identity Services: the ID token from Google's popup is exchanged for a
  // Supabase session here, no redirect through the Supabase domain.
  async function signInWithGoogleToken(token: string, rawNonce: string) {
    setPending(true);
    setNotice(null);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token,
        nonce: rawNonce
      });
      if (error) {
        setNotice(t('googleFailed'));
        return;
      }
      saveLastMethod('google');
      await afterSignIn(supabase);
    } finally {
      setPending(false);
    }
  }

  // Fallback when Google's script cannot load: the OAuth redirect flow.
  async function signInWithGoogleRedirect() {
    setPending(true);
    // Confirmed (saved as the last method) once a signed-in page loads.
    markPendingMethod('google');
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl(destination) }
    });
    if (error) {
      setPending(false);
      toast.error(t('googleUnavailable'));
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

  const googleButton = (
    /* Official Google Identity Services button (falls back to our own if blocked). */
    <GoogleSignInButton
      mode={mode}
      oneTap={mode === 'sign-in'}
      disabled={pending}
      onCredential={signInWithGoogleToken}
      onFallback={signInWithGoogleRedirect}
    />
  );
  const passkeyButton = (
    <Button
      className={PROVIDER_BUTTON}
      variant='outline'
      type='button'
      disabled={pending}
      onClick={signInWithPasskey}
    >
      <Icons.passkey className='size-5' aria-hidden />
      {t('passkey')}
    </Button>
  );

  if (preferred) {
    return (
      <div className='space-y-4'>
        <div className='relative rounded-[calc(var(--radius)+4px)] p-1 ring-2 ring-primary/40'>
          {preferred === 'google' ? googleButton : passkeyButton}
          <LastUsedBadge />
        </div>
        {notice && (
          <p role='status' className='text-muted-foreground text-sm'>
            {notice}
          </p>
        )}
        <TurnstileWidget {...captcha.widgetProps} />
        <Button
          variant='ghost'
          type='button'
          className='text-muted-foreground w-full'
          disabled={pending}
          onClick={() => setShowAll(true)}
        >
          {t('otherMethods')}
          <Icons.chevronDown className='size-4' aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {mode === 'sign-up' && <AuthSteps current={0} />}
      {(showGoogle || showPasskey) && (
        <>
          <div className='grid gap-2'>
            {showGoogle && (
              <div className='relative'>
                {googleButton}
                {mode === 'sign-in' && lastMethod === 'google' && <LastUsedBadge />}
              </div>
            )}
            {showPasskey && (
              <div className='relative'>
                {passkeyButton}
                {mode === 'sign-in' && lastMethod === 'passkey' && <LastUsedBadge />}
              </div>
            )}
          </div>
          <div className='relative'>
            <div className='absolute inset-0 flex items-center'>
              <span className='w-full border-t' />
            </div>
            <div className='relative flex justify-center text-xs uppercase'>
              <span className='bg-background text-muted-foreground px-2'>{t('orEmail')}</span>
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
                <field.TextField label={t('fullName')} autoComplete='name' disabled={pending} />
              )}
            />
          )}
          <form.AppField
            name='email'
            children={(field) => (
              <field.TextField
                label={t('email')}
                type='email'
                autoComplete={showPasskey ? 'username webauthn' : 'email'}
                placeholder={t('emailPlaceholder')}
                disabled={pending}
              />
            )}
          />
          <form.AppField
            name='password'
            children={(field) => (
              <field.TextField
                label={t('password')}
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
          {mode === 'sign-in' ? t('signIn') : t('signUp')}
        </LoadingButton>
        {mode === 'sign-in' && (
          <Link
            href='/auth/forgot-password'
            className={buttonVariants({
              variant: 'link',
              className: 'text-muted-foreground w-full'
            })}
          >
            {t('forgot')}
          </Link>
        )}
      </form>
    </div>
  );
}
