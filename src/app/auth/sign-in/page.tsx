import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getAuthMethods } from '@/lib/auth/auth-methods';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { safeNext } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';
import SignInViewPage from '@/features/auth/components/sign-in-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signIn');
  return { title: t('title'), description: t('metaDescription') };
}

export default async function Page(props: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await props.searchParams;
  // Already signed in (single LevelUp session): go straight to the destination.
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user) {
    // Second factor still pending: finish it before leaving the sign-in flow.
    if (await needsMfaChallenge(supabase, user)) redirect(mfaChallengeUrl(safeNext(next)));
    redirect(safeNext(next));
  }
  const methods = await getAuthMethods();
  return <SignInViewPage next={next} error={error} methods={methods} />;
}
