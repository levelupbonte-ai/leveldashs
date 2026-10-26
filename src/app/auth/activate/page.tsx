import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import AuthShell from '@/features/auth/components/auth-shell';
import { ActivationCodeForm } from '@/features/auth/components/activation-code-form';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { createClient } from '@/lib/supabase/server';

const SELF = '/auth/activate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.activate');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

// "I have an activation code": a signed-in account enters the one-time code
// LevelUp sent. Signed-out visitors sign in (or create their account) first.
export default async function Page() {
  const db = await createClient();
  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(SELF)}`);
  if (await needsMfaChallenge(db, user)) redirect(mfaChallengeUrl(SELF));
  const t = await getTranslations('auth.activate');
  return (
    <AuthShell title={t('title')} description={t('description')}>
      <ActivationCodeForm email={user.email ?? ''} />
    </AuthShell>
  );
}
