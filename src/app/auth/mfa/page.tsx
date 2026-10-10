import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import AuthShell from '@/features/auth/components/auth-shell';
import MfaChallengeForm from '@/features/auth/components/mfa-challenge-form';
import { needsMfaChallenge } from '@/lib/auth/mfa';
import { safeNext } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.mfa');
  return { title: t('title'), description: t('metaDescription') };
}

// Second step of the sign-in for accounts with an authenticator app (TOTP):
// the session is aal1 until the 6-digit code is verified.
export default async function Page(props: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await props.searchParams;
  const destination = safeNext(next);
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(destination)}`);
  if (!(await needsMfaChallenge(supabase, user))) redirect(destination);

  const t = await getTranslations('auth.mfa');
  return (
    <AuthShell title={t('title')} description={t('description')}>
      <MfaChallengeForm next={destination} />
    </AuthShell>
  );
}
