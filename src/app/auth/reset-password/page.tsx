import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AuthShell from '@/features/auth/components/auth-shell';
import ResetPasswordForm from '@/features/auth/components/reset-password-form';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.reset');
  return { title: t('title'), description: t('metaDescription') };
}

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

  const t = await getTranslations('auth.reset');
  if (!user) {
    return (
      <AuthShell title={t('expiredTitle')} description={t('expiredDescription')}>
        <Link
          href='/auth/sign-in'
          className='hover:text-primary text-center text-sm underline underline-offset-4'
        >
          {t('backToSignIn')}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('title')}
      description={user.email ? t('descriptionFor', { email: user.email }) : t('metaDescription')}
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
