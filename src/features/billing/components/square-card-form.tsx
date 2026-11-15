'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/** Public ids for Square's card fields (never the access token). */
export interface SquareClientConfig {
  applicationId: string;
  locationId: string;
  sandbox: boolean;
}

interface SquareCardField {
  attach: (el: HTMLElement) => Promise<void>;
  tokenize: () => Promise<{ status: string; token?: string }>;
  destroy: () => Promise<boolean>;
}
interface SquarePayments {
  card: () => Promise<SquareCardField>;
  verifyBuyer: (
    token: string,
    details: Record<string, unknown>
  ) => Promise<{ token?: string } | null>;
}
declare global {
  interface Window {
    Square?: { payments: (appId: string, locationId: string) => SquarePayments };
  }
}

let loading: Promise<void> | null = null;
function loadSquare(sandbox: boolean): Promise<void> {
  if (window.Square) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = sandbox
      ? 'https://sandbox.web.squarecdn.com/v1/square.js'
      : 'https://web.squarecdn.com/v1/square.js';
    script.async = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => {
        loading = null;
        reject(new Error('square_unavailable'));
      },
      { once: true }
    );
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Square's own secure card fields (Web Payments SDK). The card number never
 * touches LevelUp: Square returns a one-time token that the server uses to save
 * the card on the client's Square customer.
 */
export function SquareCardForm({
  config,
  submitLabel,
  busy,
  onToken
}: {
  config: SquareClientConfig;
  submitLabel: string;
  busy: boolean;
  onToken: (sourceId: string, verificationToken?: string) => Promise<void>;
}) {
  const t = useTranslations('billing.autopay.form');
  const box = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<SquareCardField | null>(null);
  const [payments, setPayments] = useState<SquarePayments | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let field: SquareCardField | null = null;
    let alive = true;
    (async () => {
      try {
        await loadSquare(config.sandbox);
        if (!alive || !window.Square || !box.current) return;
        const p = window.Square.payments(config.applicationId, config.locationId);
        field = await p.card();
        if (!alive) return;
        await field.attach(box.current);
        setPayments(p);
        setCard(field);
        setState('ready');
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => {
      alive = false;
      void field?.destroy().catch(() => false);
    };
  }, [config.applicationId, config.locationId, config.sandbox]);

  const submit = async () => {
    if (!card || !payments) return;
    setMessage(null);
    const result = await card
      .tokenize()
      .catch(() => ({ status: 'ERROR' }) as { status: string; token?: string });
    if (result.status !== 'OK' || !result.token) {
      setMessage(t('invalid'));
      return;
    }
    // Strong customer authentication when the bank asks for it (else no token).
    let verification: string | undefined;
    try {
      verification = (
        await payments.verifyBuyer(result.token, { intent: 'STORE', billingContact: {} })
      )?.token;
    } catch {
      verification = undefined;
    }
    await onToken(result.token, verification);
  };

  return (
    <div className='space-y-3'>
      {state === 'loading' && <Skeleton className='h-12 w-full' />}
      {state === 'error' && <p className='text-destructive text-sm'>{t('unavailable')}</p>}
      <div ref={box} className={state === 'ready' ? 'min-h-12' : 'hidden'} />
      {message && (
        <p className='text-destructive text-sm' role='alert'>
          {message}
        </p>
      )}
      <Button className='w-full' disabled={state !== 'ready' || busy} onClick={() => void submit()}>
        <Icons.lock aria-hidden /> {busy ? t('saving') : submitLabel}
      </Button>
      <p className='text-muted-foreground flex items-center gap-1.5 text-xs'>
        <Icons.shieldCheck className='size-3.5' aria-hidden />
        {t('secure')}
      </p>
    </div>
  );
}
