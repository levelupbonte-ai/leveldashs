'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

/**
 * Optional Cloudflare Turnstile CAPTCHA for the auth forms. Only active when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is set; Supabase Auth must then have CAPTCHA
 * protection enabled with the matching Turnstile secret (see docs/auth.md).
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
export const CAPTCHA_ENABLED = TURNSTILE_SITE_KEY.length > 0;

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
      theme?: 'auto' | 'light' | 'dark';
      language?: string;
      size?: 'normal' | 'flexible' | 'compact';
    }
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.addEventListener(
        'load',
        () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile'))),
        { once: true }
      );
      script.addEventListener(
        'error',
        () => {
          scriptPromise = null;
          reject(new Error('turnstile'));
        },
        { once: true }
      );
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export interface TurnstileHandle {
  /** Turnstile tokens are single-use: reset after every Supabase auth call. */
  reset: () => void;
}

export function TurnstileWidget({
  onToken,
  ref
}: {
  onToken: (token: string | null) => void;
  ref?: React.Ref<TurnstileHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useImperativeHandle(ref, () => ({
    reset() {
      onTokenRef.current(null);
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    }
  }));

  useEffect(() => {
    if (!CAPTCHA_ENABLED) return;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'auto',
          language: 'fr',
          size: 'flexible',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null)
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, []);

  if (!CAPTCHA_ENABLED) return null;
  return (
    <div className='space-y-1'>
      <div ref={containerRef} className='min-h-[65px]' />
      {failed && (
        <p className='text-destructive text-xs'>
          Vérification anti-robot indisponible. Rechargez la page.
        </p>
      )}
    </div>
  );
}

/** Captcha state for a form: token, widget props and a reset helper. */
export function useCaptcha() {
  const [token, setToken] = useState<string | null>(null);
  const widgetRef = useRef<TurnstileHandle>(null);
  const reset = useCallback(() => widgetRef.current?.reset(), []);
  return {
    enabled: CAPTCHA_ENABLED,
    token,
    /** `options.captchaToken` for supabase.auth calls (undefined when disabled). */
    captchaToken: CAPTCHA_ENABLED ? (token ?? undefined) : undefined,
    ready: !CAPTCHA_ENABLED || !!token,
    reset,
    widgetProps: { onToken: setToken, ref: widgetRef }
  };
}
