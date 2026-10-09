import Link from 'next/link';
import { Icons } from '@/components/icons';

/**
 * Nudge towards the authenticator app (TOTP). Approved members get a direct link
 * to Profil → Sécurité; others are told where to find it once access opens.
 */
export function MfaSuggestion({ canOpenDashboard }: { canOpenDashboard: boolean }) {
  return (
    <div className='flex gap-3 rounded-lg border border-violet-500/25 bg-violet-500/5 p-3 text-left text-xs'>
      <Icons.shield className='mt-0.5 size-4 shrink-0 text-violet-500' aria-hidden />
      <div className='space-y-1'>
        <p className='text-foreground font-medium'>Protégez votre compte</p>
        <p className='text-muted-foreground'>
          Activez la double authentification avec une application (Google Authenticator, 1Password…)
          : un code à 6 chiffres vous sera demandé à chaque connexion.
        </p>
        {canOpenDashboard ? (
          <Link
            href='/dashboard/profile#securite'
            className='text-primary font-medium underline underline-offset-4'
          >
            Activer l’application d’authentification
          </Link>
        ) : (
          <p className='text-muted-foreground'>
            Dès que votre accès est validé : Profil → Sécurité.
          </p>
        )}
      </div>
    </div>
  );
}

/** One line pointing to Profil → Sécurité once passkeys are enabled in Supabase. */
export function PasskeySuggestion({ canOpenDashboard }: { canOpenDashboard: boolean }) {
  return (
    <p className='text-muted-foreground flex items-start gap-2 text-left text-xs'>
      <Icons.passkey className='mt-0.5 size-4 shrink-0' aria-hidden />
      <span>
        Connectez-vous plus vite avec une passkey (Face ID, Touch ID, Windows Hello) :{' '}
        {canOpenDashboard ? (
          <Link
            href='/dashboard/profile#securite'
            className='text-primary font-medium underline underline-offset-4'
          >
            Profil → Sécurité
          </Link>
        ) : (
          'Profil → Sécurité, dès que votre accès est validé'
        )}
        .
      </span>
    </p>
  );
}
