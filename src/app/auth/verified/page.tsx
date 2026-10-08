import { Metadata } from 'next';
import AuthShell from '@/features/auth/components/auth-shell';
import { EmailVerifiedView } from '@/features/auth/components/email-verified-view';
import { safeNext } from '@/lib/auth/redirect';

export const metadata: Metadata = {
  title: 'Adresse e-mail vérifiée',
  description: 'Votre adresse e-mail LevelUp est confirmée.'
};

// Landing page of the sign-up confirmation link (after /auth/callback created the
// session on this device). The sign-up tab on the first device moves on by itself.
export default async function Page(props: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await props.searchParams;
  return (
    <AuthShell
      title='Félicitations, votre adresse e‑mail est vérifiée'
      description='Votre compte LevelUp est activé.'
    >
      <EmailVerifiedView next={safeNext(next, '/auth/onboarding')} />
    </AuthShell>
  );
}
