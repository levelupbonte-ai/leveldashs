import { Metadata } from 'next';
import AuthShell from '@/features/auth/components/auth-shell';
import ForgotPasswordForm from '@/features/auth/components/forgot-password-form';

export const metadata: Metadata = {
  title: 'Mot de passe oublié',
  description: 'Recevez un lien pour choisir un nouveau mot de passe.'
};

export default function Page() {
  return (
    <AuthShell
      title='Mot de passe oublié'
      description='Indiquez l’adresse de votre compte : nous vous envoyons un lien pour en choisir un nouveau.'
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
