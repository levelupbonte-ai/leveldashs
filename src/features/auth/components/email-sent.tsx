'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { type Captcha, TurnstileWidget, useCaptcha } from './turnstile';

const COOLDOWN_SECONDS = 60;

/**
 * Clear confirmation after an e-mail is sent (sign-up, reset, magic link): what
 * was sent, where, what to do next, and a resend button with a cooldown.
 */
export function EmailSent({
  email,
  title,
  description,
  onResend,
  backHref = '/auth/sign-in',
  backLabel = 'Retour à la connexion',
  onChangeEmail,
  captcha: sharedCaptcha,
  children
}: {
  email: string;
  title: string;
  description: string;
  onResend: (captchaToken: string | undefined) => Promise<void>;
  backHref?: string;
  backLabel?: string;
  onChangeEmail?: () => void;
  /** Captcha owned by the parent when it also needs tokens (e.g. auto sign-in). */
  captcha?: Captcha;
  /** Extra content under the description (e.g. automatic verification status). */
  children?: React.ReactNode;
}) {
  const ownCaptcha = useCaptcha();
  const captcha = sharedCaptcha ?? ownCaptcha;
  const [wait, setWait] = useState(COOLDOWN_SECONDS);
  const [sending, setSending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function resend() {
    if (!captcha.ready || sending || wait > 0) return;
    setSending(true);
    try {
      await onResend(captcha.captchaToken);
      setResent(true);
      setWait(COOLDOWN_SECONDS);
    } finally {
      captcha.reset();
      setSending(false);
    }
  }

  return (
    <div className='space-y-5' role='status' aria-live='polite'>
      <div className='bg-muted mx-auto grid size-12 place-items-center rounded-full'>
        <Icons.mail className='size-6' aria-hidden />
      </div>
      <div className='space-y-2 text-center'>
        <h2 className='text-lg font-semibold'>{title}</h2>
        <p className='text-muted-foreground text-sm'>
          {description} <span className='text-foreground font-medium break-all'>{email}</span>
        </p>
      </div>
      {children}
      <ul className='text-muted-foreground space-y-1.5 rounded-lg border p-3 text-xs'>
        <li>Le lien est valable une heure et ne fonctionne qu’une fois.</li>
        <li>Rien reçu ? Regardez dans les courriers indésirables ou les promotions.</li>
        <li>L’e-mail vient de LevelUp Ecosystem (levelup-ecosystem.com).</li>
      </ul>
      <TurnstileWidget {...captcha.widgetProps} />
      <Button
        type='button'
        variant='outline'
        className='w-full'
        disabled={wait > 0 || sending}
        onClick={resend}
      >
        {sending ? (
          <Icons.spinner className='size-4 animate-spin' aria-hidden />
        ) : wait > 0 ? (
          `Renvoyer l’e-mail dans ${wait} s`
        ) : (
          'Renvoyer l’e-mail'
        )}
      </Button>
      {resent && (
        <p className='text-muted-foreground text-center text-xs'>
          Un nouvel e-mail vient d’être envoyé.
        </p>
      )}
      <div className='flex items-center justify-between text-sm'>
        {onChangeEmail ? (
          <button
            type='button'
            onClick={onChangeEmail}
            className='text-muted-foreground hover:text-primary underline underline-offset-4'
          >
            Changer d’adresse
          </button>
        ) : (
          <span />
        )}
        <Link
          href={backHref}
          className='text-muted-foreground hover:text-primary underline underline-offset-4'
        >
          {backLabel}
        </Link>
      </div>
    </div>
  );
}
