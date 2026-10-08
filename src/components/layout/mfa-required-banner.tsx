'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icons } from '@/components/icons';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { useDashboardSession } from '@/lib/auth/session-context';

/**
 * Persistent reminder for accounts that can manage teams (org owners/admins,
 * LevelUp platform admins) until they turn on two-factor authentication.
 */
export function MfaRequiredBanner() {
  const { mfa } = useDashboardSession();
  const pathname = usePathname();
  if (!mfa.required || mfa.enabled) return null;
  const onProfile = pathname === '/dashboard/profile';

  return (
    <div className='px-4 pt-4 md:px-6'>
      <Alert variant='destructive' role='alert'>
        <Icons.shield className='size-4' />
        <AlertTitle>Activez la vérification en deux étapes</AlertTitle>
        <AlertDescription>
          Votre compte peut gérer des membres et des accès : protégez-le avec une application
          d’authentification (code à 6 chiffres).
        </AlertDescription>
        {!onProfile && (
          <AlertAction>
            <Link
              href='/dashboard/profile#securite'
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              Activer
            </Link>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
}
