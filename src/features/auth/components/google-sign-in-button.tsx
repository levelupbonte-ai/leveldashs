'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { GOOGLE_CLIENT_ID } from '@/lib/auth/google';
import { cn } from '@/lib/utils';
import { PROVIDER_BUTTON, PROVIDER_BUTTON_COVERED } from '../lib/provider-button';
import { createNonce, loadGoogleIdentity, type GoogleAccountsId } from '../lib/google-identity';

// GIS accepts a width between 200 and 400 px.
const clampWidth = (width: number) => Math.round(Math.min(400, Math.max(200, width)));
// Google's button iframe has no size until its page has loaded; when it never
// does (origin not authorized for the client id, Google's assets blocked), we
// use the redirect flow instead.
const IFRAME_TIMEOUT_MS = 6000;

/**
 * "Continue with Google": our own button (theme colours, official "G"), so it
 * matches the passkey button in light and dark mode.
 *
 * Sign-in still goes through Google Identity Services: Google's official button
 * is rendered transparent over ours and receives the click, so the popup runs on
 * the dashboard's origin (Google shows our domain, not the Supabase project URL)
 * and returns an ID token bound to a fresh nonce, handed to `onCredential`
 * (`supabase.auth.signInWithIdToken`). Until that button is ready, or when it
 * cannot load (network, blocker, origin not allowed), a click on our button runs
 * `onFallback` (OAuth redirect) so nobody is stuck.
 */
export function GoogleSignInButton({
  mode,
  oneTap = false,
  disabled = false,
  locked = false,
  onCredential,
  onFallback,
  className
}: {
  mode: 'sign-in' | 'sign-up';
  /** Also show the One Tap prompt (sign-in page only). */
  oneTap?: boolean;
  disabled?: boolean;
  /** Waiting for a precondition (sign-up terms): shows a lock. */
  locked?: boolean;
  onCredential: (token: string, rawNonce: string) => void | Promise<void>;
  onFallback: () => void;
  className?: string;
}) {
  const t = useTranslations('auth.google');
  const locale = useLocale();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const gisRef = useRef<HTMLDivElement>(null);
  const nonceRef = useRef<string | null>(null);
  const onCredentialRef = useRef(onCredential);
  const [gis, setGis] = useState<GoogleAccountsId | null>(null);
  // Google's button is rendered and sized: it takes the clicks.
  const [gisReady, setGisReady] = useState(false);
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
      .catch(() => undefined);
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
    if (!gis || !gisRef.current || !width) return;
    let cancelled = false;
    void createNonce().then(({ raw, hashed }) => {
      if (cancelled || !gisRef.current) return;
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
      gisRef.current.replaceChildren();
      // Invisible, so only its size and label matter (label: screen readers).
      gis.renderButton(gisRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        width,
        locale
      });
      if (oneTap && attempt === 0) gis.prompt();
    });
    return () => {
      cancelled = true;
    };
  }, [gis, width, locale, mode, oneTap, attempt]);

  // Ready once Google's iframe has a size; never ready → redirect flow.
  useEffect(() => {
    if (!gis || gisReady) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const frame = gisRef.current?.querySelector('iframe');
      if (frame && frame.getBoundingClientRect().width > 0) {
        setGisReady(true);
        window.clearInterval(timer);
      } else if (Date.now() - started > IFRAME_TIMEOUT_MS) {
        window.clearInterval(timer);
      }
    }, 150);
    return () => window.clearInterval(timer);
  }, [gis, gisReady]);

  // Stop One Tap when leaving the page.
  useEffect(() => () => gis?.cancel(), [gis]);

  return (
    <div ref={wrapperRef} className={cn('group/provider relative w-full', className)}>
      <Button
        variant='outline'
        type='button'
        disabled={disabled}
        // Google's button on top takes the clicks and the focus.
        tabIndex={gisReady ? -1 : undefined}
        aria-hidden={gisReady || undefined}
        onClick={gisReady ? undefined : onFallback}
        className={cn(PROVIDER_BUTTON, gisReady && !disabled && PROVIDER_BUTTON_COVERED)}
      >
        <Icons.googleColor size={18} className={cn(locked && 'grayscale')} />
        {t('continue')}
        {locked && (
          <Icons.lock className='text-muted-foreground absolute right-3 size-4' aria-hidden />
        )}
      </Button>
      {gis && (
        <div
          ref={gisRef}
          className={cn(
            'absolute inset-0 z-10 flex items-center justify-center overflow-hidden rounded-lg opacity-0',
            (!gisReady || disabled) && 'pointer-events-none invisible'
          )}
        />
      )}
    </div>
  );
}
