import { Metadata } from 'next';
import Link from 'next/link';
import AuthShell from '@/features/auth/components/auth-shell';
import ResetPasswordForm from '@/features/auth/components/reset-password-form';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Nouveau mot de passe',
  description: 'Choisissez un nouveau mot de passe pour votre compte LevelUp.'
};

// Reached from the reset e-mail: /auth/callback verifies the link (recovery
// token) and opens a session, then sends the user here.
export default async function Page() {
  const {
    data: { user }
  } = await (await createClient()).auth.getUser();

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
