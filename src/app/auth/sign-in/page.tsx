import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { invitedEmailFor } from '@/lib/access/server';
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
  searchParams: Promise<{ next?: string; error?: string; reason?: string }>;
}) {
  const { next, error, reason } = await props.searchParams;
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
  // Started from an invitation link: the invited address, prefilled and locked.
  const [methods, lockedEmail] = await Promise.all([getAuthMethods(), invitedEmailFor(next)]);
  return (
    <SignInViewPage
      next={next}
      error={error}
      reason={reason}
      methods={methods}
      lockedEmail={lockedEmail}
    />
  );
}
