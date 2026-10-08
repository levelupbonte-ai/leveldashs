import { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AuthShell from '@/features/auth/components/auth-shell';
import ResetPasswordForm from '@/features/auth/components/reset-password-form';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Nouveau mot de passe',
  description: 'Choisissez un nouveau mot de passe pour votre compte LevelUp.'
};

// Reached from the reset e-mail: /auth/callback verifies the link (recovery
// token) and opens a session, then sends the user here.
export default async function Page() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  // Accounts with an authenticator app confirm the code before changing the password.
  if (user && (await needsMfaChallenge(supabase, user))) {
    redirect(mfaChallengeUrl('/auth/reset-password'));
  }

  if (!user) {
    return (
      <AuthShell
        title='Lien expiré'
        description='Ce lien de réinitialisation n’est plus valide. Demandez-en un nouveau.'
      >
        <Link
          href='/auth/sign-in'
          className='hover:text-primary text-center text-sm underline underline-offset-4'
        >
          Retour à la connexion
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title='Nouveau mot de passe'
      description={`Choisissez un nouveau mot de passe pour ${user.email ?? 'votre compte'}.`}
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
