import Link from 'next/link';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MfaSuggestion, PasskeySuggestion } from './account-suggestions';
import { AuthSteps } from './auth-steps';
import { SignOutButton } from './sign-out-button';

const CONTACT = 'contact@levelup-ecosystem.com';
const SENDER = 'account@levelup-ecosystem.com';
const STUDIO_URL = 'https://studio.levelup-ecosystem.com';

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

type Step = { title: string; detail: React.ReactNode; state: 'done' | 'current' | 'next' };

function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className='space-y-0' aria-label='Suivi de votre demande'>
      {steps.map((step, i) => (
        <li
          key={step.title}
          className='relative flex gap-3 pb-4 last:pb-0'
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className={cn(
                'absolute top-6 bottom-0 left-[11px] w-px',
                step.state === 'done' ? 'bg-primary/40' : 'bg-border'
              )}
            />
          )}
          <span
            aria-hidden
            className={cn(
              'relative z-10 grid size-6 shrink-0 place-items-center rounded-full border text-[11px]',
              step.state === 'done' && 'border-primary bg-primary text-primary-foreground',
              step.state === 'current' &&
                'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400',
              step.state === 'next' && 'bg-background text-muted-foreground'
            )}
          >
            {step.state === 'done' ? (
              <Icons.check className='size-3.5' />
            ) : step.state === 'current' ? (
              <span className='size-2 animate-pulse rounded-full bg-amber-500' />
            ) : (
              i + 1
            )}
          </span>
          <div className='min-w-0 flex-1 pt-0.5 text-sm'>
            <p
              className={cn(
                'leading-tight font-medium',
                step.state === 'next' && 'text-muted-foreground'
              )}
            >
              {step.title}
              {step.state === 'current' && (
                <span className='ml-2 inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 align-middle text-[10px] font-medium text-amber-700 dark:text-amber-300'>
                  En cours
                </span>
              )}
            </p>
            <div className='text-muted-foreground mt-0.5 text-xs break-words'>{step.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Signed-in account whose access request waits for the LevelUp team. */
export function PendingAccountView({
  email,
  businessName,
  submittedAt,
  mfaEnabled,
  passkeyEnabled
}: {
  email: string;
  businessName: string;
  submittedAt: string | null;
  mfaEnabled: boolean;
  passkeyEnabled: boolean;
}) {
  const date = formatDate(submittedAt);
  return (
    <div className='space-y-5' role='status'>
      <AuthSteps current={3} waiting />

      <section className='bg-card space-y-4 rounded-xl border p-4 shadow-xs'>
        <div className='flex items-start gap-3'>
          <div className='grid size-10 shrink-0 place-items-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400'>
            <Icons.hourglass className='size-5' aria-hidden />
          </div>
          <div className='min-w-0 flex-1'>
            <p className='text-muted-foreground text-xs'>Demande d’accès</p>
            <p className='font-semibold break-words'>{businessName || 'Votre entreprise'}</p>
            {date && <p className='text-muted-foreground text-xs'>Envoyée le {date}</p>}
          </div>
        </div>
        <Timeline
          steps={[
            {
              title: 'Compte créé',
              detail: <span className='break-all'>{email}</span>,
              state: 'done'
            },
            {
              title: 'Demande envoyée',
              detail: 'Vos informations ont bien été transmises à l’équipe LevelUp.',
              state: 'done'
            },
            {
              title: 'Vérification par l’équipe',
              detail: 'En général sous 24 h ouvrées (du lundi au vendredi).',
              state: 'current'
            },
            {
              title: 'Accès au tableau de bord',
              detail:
                'Votre organisation est créée et vous en êtes propriétaire : site, réservations et demandes au même endroit.',
              state: 'next'
            }
          ]}
        />
      </section>

      <section className='flex gap-3 rounded-xl border border-violet-500/25 bg-violet-500/5 p-4 text-sm'>
        <Icons.mail className='mt-0.5 size-5 shrink-0 text-violet-500' aria-hidden />
        <div className='min-w-0 space-y-1'>
          <p className='font-medium'>Surveillez votre boîte de réception</p>
          <p className='text-muted-foreground text-xs'>
            Dès que votre accès est validé, vous recevrez un e-mail à{' '}
            <strong className='text-foreground break-all'>{email}</strong> envoyé par{' '}
            <span className='break-all'>{SENDER}</span>, objet « Votre accès au tableau de bord
            LevelUp est validé ». Pensez à vérifier vos courriers indésirables.
          </p>
          <p className='text-muted-foreground text-xs'>
            Il suffira ensuite de vous reconnecter : le tableau de bord s’ouvrira directement.
          </p>
        </div>
      </section>

      <div className='grid gap-2'>
        <Link
          href='/auth/onboarding?edit=1'
          className={buttonVariants({ variant: 'outline', className: 'w-full' })}
        >
          <Icons.edit className='size-4' aria-hidden />
          Modifier ma demande
        </Link>
        <a
          href={STUDIO_URL}
          className={buttonVariants({ variant: 'outline', className: 'w-full' })}
        >
          En attendant, essayer LevelStudio
          <Icons.externalLink className='size-4' aria-hidden />
        </a>
        <SignOutButton className='text-muted-foreground w-full' />
      </div>

      {!mfaEnabled && <MfaSuggestion canOpenDashboard={false} />}
      {passkeyEnabled && <PasskeySuggestion canOpenDashboard={false} />}

      <p className='text-muted-foreground text-center text-xs'>
        Une question ?{' '}
        <a href={`mailto:${CONTACT}`} className='underline underline-offset-4'>
          {CONTACT}
        </a>
      </p>
    </div>
  );
}

/** Access request turned down by the LevelUp team. */
export function RejectedAccountView({
  email,
  businessName
}: {
  email: string;
  businessName: string;
}) {
  return (
    <div className='space-y-5' role='status'>
      <section className='bg-card space-y-3 rounded-xl border p-4 shadow-xs'>
        <div className='flex items-start gap-3'>
          <div className='bg-destructive/10 text-destructive grid size-10 shrink-0 place-items-center rounded-full'>
            <Icons.circleX className='size-5' aria-hidden />
          </div>
          <div className='min-w-0 flex-1'>
            <p className='text-muted-foreground text-xs'>Demande d’accès</p>
            <p className='font-semibold break-words'>{businessName || 'Votre entreprise'}</p>
            <p className='text-muted-foreground text-xs break-all'>{email}</p>
          </div>
        </div>
        <p className='text-muted-foreground text-sm'>
          Le tableau de bord est réservé aux clients LevelUp. Pour toute question ou pour créer
          votre site avec LevelUp, écrivez-nous : nous vous répondrons rapidement.
        </p>
      </section>
      <div className='grid gap-2'>
        <a
          href={`mailto:${CONTACT}`}
          className={buttonVariants({ variant: 'default', className: 'w-full' })}
        >
          <Icons.mail className='size-4' aria-hidden />
          Écrire à LevelUp
        </a>
        <a
          href={STUDIO_URL}
          className={buttonVariants({ variant: 'outline', className: 'w-full' })}
        >
          Continuer vers LevelStudio
          <Icons.externalLink className='size-4' aria-hidden />
        </a>
        <SignOutButton className='text-muted-foreground w-full' />
      </div>
    </div>
  );
}
