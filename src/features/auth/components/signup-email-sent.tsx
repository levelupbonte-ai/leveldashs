'use client';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useEmailVerificationWatch } from '../hooks/use-email-verification-watch';
import { AuthSteps } from './auth-steps';
import { EmailSent } from './email-sent';
import { useCaptcha } from './turnstile';

/**
 * "Confirmez votre adresse e-mail" after sign-up. Watches for the confirmation
 * (even when the link is opened on another device) and moves on by itself.
 */
export function SignupEmailSent({
  email,
  password,
  onResend,
  onChangeEmail,
  onVerified
}: {
  email: string;
  password: string;
  onResend: (captchaToken: string | undefined) => Promise<void>;
  onChangeEmail: () => void;
  onVerified: () => void;
}) {
  const captcha = useCaptcha();
  const { status, restart } = useEmailVerificationWatch({
    email,
    password,
    captcha,
    onVerified
  });

  if (status === 'verified') {
    return (
      <div className='space-y-6' role='status' aria-live='polite'>
        <AuthSteps current={2} />
        <div className='space-y-3 text-center'>
          <div className='mx-auto grid size-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'>
            <Icons.circleCheck className='size-6' aria-hidden />
          </div>
          <h2 className='text-lg font-semibold'>Adresse e-mail vérifiée</h2>
          <p className='text-muted-foreground flex items-center justify-center gap-2 text-sm'>
            <Icons.spinner className='size-4 animate-spin' aria-hidden />
            Passage à l’étape suivante…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <AuthSteps current={1} waiting />
      <EmailSent
        email={email}
        title='Confirmez votre adresse e-mail'
        description='Pour activer votre compte, cliquez sur le lien que nous venons d’envoyer à'
        onResend={onResend}
        onChangeEmail={onChangeEmail}
        captcha={captcha}
      >
        {status === 'waiting' ? (
          <p className='text-muted-foreground flex items-center justify-center gap-2 rounded-lg bg-violet-500/5 px-3 py-2 text-center text-xs'>
            <span className='relative flex size-2 shrink-0'>
              <span className='absolute inline-flex size-full animate-ping rounded-full bg-violet-500 opacity-60' />
              <span className='relative inline-flex size-2 rounded-full bg-violet-500' />
            </span>
            Vous pouvez ouvrir le lien sur votre téléphone : cette page continuera toute seule.
          </p>
        ) : (
          <div className='space-y-2 rounded-lg border p-3 text-center text-xs'>
            <p className='text-muted-foreground'>
              {status === 'stopped'
                ? 'La vérification automatique s’est arrêtée. Vous avez cliqué sur le lien ?'
                : 'Connectez-vous avec votre nouveau mot de passe pour continuer.'}
            </p>
            {status === 'stopped' && (
              <Button type='button' size='sm' variant='secondary' onClick={restart}>
                Vérifier maintenant
              </Button>
            )}
          </div>
        )}
      </EmailSent>
    </div>
  );
}
