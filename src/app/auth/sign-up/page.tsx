import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { safeNext } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';
import SignUpViewPage from '@/features/auth/components/sign-up-view';

export const metadata: Metadata = {
  title: 'Créer un compte',
  description: 'Créer un compte LevelUp.'
};

export default async function Page(props: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await props.searchParams;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user) {
    // Second factor still pending: finish it before leaving the sign-in flow.
    if (await needsMfaChallenge(supabase, user)) redirect(mfaChallengeUrl(safeNext(next)));
    redirect(safeNext(next));
  }
  return <SignUpViewPage next={next} />;
}
