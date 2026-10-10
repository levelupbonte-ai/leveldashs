'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { GOOGLE_CLIENT_ID } from '@/lib/auth/google';
import { cn } from '@/lib/utils';
import { createNonce, loadGoogleIdentity, type GoogleAccountsId } from '../lib/google-identity';

// GIS accepts a width between 200 and 400 px.
const clampWidth = (width: number) => Math.round(Math.min(400, Math.max(200, width)));

/**
 * The official "Sign in with Google" button (Google Identity Services). Its
 * popup shows the dashboard's own domain, not the Supabase project URL. On
 * success it hands the ID token and the raw nonce to `onCredential`
 * (`supabase.auth.signInWithIdToken`). If Google's script cannot load
 * (network, blocker), a LevelUp-styled button runs `onFallback` (OAuth redirect)
 * so nobody is stuck.
 */
export function GoogleSignInButton({
  mode,
  oneTap = false,
  disabled = false,
  onCredential,
  onFallback,
  className
}: {
  mode: 'sign-in' | 'sign-up';
  /** Also show the One Tap prompt (sign-in page only). */
  oneTap?: boolean;
  disabled?: boolean;
  onCredential: (token: string, rawNonce: string) => void | Promise<void>;
  onFallback: () => void;
  className?: string;
}) {
  const t = useTranslations('auth.google');
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const nonceRef = useRef<string | null>(null);
  const onCredentialRef = useRef(onCredential);
  const [gis, setGis] = useState<GoogleAccountsId | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  // A new nonce for every attempt: bumping this re-initializes GIS.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onCredentialRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    let active = true;
    loadGoogleIdentity()
      .then((id) => active && setGis(id))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  // Full width of the auth card, kept in sync on resize.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => setWidth(clampWidth(el.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!gis || !buttonRef.current || !width) return;
    let cancelled = false;
    void createNonce().then(({ raw, hashed }) => {
      if (cancelled || !buttonRef.current) return;
      nonceRef.current = raw;
      gis.initialize({
        client_id: GOOGLE_CLIENT_ID,
        nonce: hashed,
        context: mode === 'sign-up' ? 'signup' : 'signin',
        ux_mode: 'popup',
        use_fedcm_for_prompt: true,
        itp_support: true,
        callback: (response) => {
          const rawNonce = nonceRef.current;
          if (!response.credential || !rawNonce) return;
          // The nonce is single-use: prepare a fresh one for a retry.
          nonceRef.current = null;
          setAttempt((n) => n + 1);
          void onCredentialRef.current(response.credential, rawNonce);
        }
      });
      buttonRef.current.replaceChildren();
      gis.renderButton(buttonRef.current, {
        type: 'standard',
        theme: resolvedTheme === 'dark' ? 'filled_black' : 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'center',
        width,
        locale
      });
      if (oneTap && attempt === 0) gis.prompt();
    });
    return () => {
      cancelled = true;
    };
  }, [gis, width, resolvedTheme, locale, mode, oneTap, attempt]);

  // Stop One Tap when leaving the page.
  useEffect(() => () => gis?.cancel(), [gis]);

  if (failed) {
    return (
      <Button
        variant='outline'
        type='button'
        disabled={disabled}
        onClick={onFallback}
        className={cn(
          'h-10 w-full gap-3 border-[#747775] bg-white text-[15px] font-medium text-[#1F1F1F] shadow-sm hover:bg-[#F8F9FA] hover:text-[#1F1F1F] dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3] dark:hover:bg-[#1E1F20] dark:hover:text-[#E3E3E3]',
          className
        )}
      >
        <Icons.googleColor size={20} />
        {t('continue')}
      </Button>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'relative flex min-h-10 w-full items-center justify-center',
        disabled && 'pointer-events-none opacity-60',
        className
      )}
      aria-busy={!gis}
    >
      {!gis && (
        <div
          role='status'
          className='bg-muted/60 absolute inset-0 animate-pulse rounded-md border'
          aria-label={t('loading')}
        />
      )}
      <div ref={buttonRef} className='flex w-full justify-center [color-scheme:normal]' />
    </div>
  );
}
