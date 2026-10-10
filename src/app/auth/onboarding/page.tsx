import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import AuthShell from '@/features/auth/components/auth-shell';
import OnboardingFlow from '@/features/auth/components/onboarding-flow';
import { RecordLastMethod } from '@/features/auth/components/record-last-method';
import { getAccessRequest, hasDashboardAccess, PENDING_PATH } from '@/lib/auth/access';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { isExternalNext, safeNext } from '@/lib/auth/redirect';
import { getDashboardSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.onboarding');
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function Page(props: {
  searchParams: Promise<{ next?: string; edit?: string }>;
}) {
  const { next, edit } = await props.searchParams;
  const destination = safeNext(next);
  const session = await getDashboardSession();
  if (!session) redirect(`/auth/sign-in?next=${encodeURIComponent('/auth/onboarding')}`);

  const db = await createClient();
  // Authenticator app already set up: the 6-digit code comes before anything else.
  const {
    data: { user }
  } = await db.auth.getUser();
  if (await needsMfaChallenge(db, user)) {
    redirect(mfaChallengeUrl(`/auth/onboarding?next=${encodeURIComponent(destination)}`));
  }

  const hasAccess = hasDashboardAccess(session);
  const request = await getAccessRequest(session.user.id);
  const forOtherApp = isExternalNext(destination);
  const editing = edit === '1' && request?.status === 'pending';
  // Request already sent (or turned down): the status page, not the profile form
  // again. Visitors heading back to another LevelUp app keep going there.
  if (!hasAccess && !forOtherApp && !editing) {
    if (request?.status === 'pending' || request?.status === 'rejected') redirect(PENDING_PATH);
  }

  const t = await getTranslations('auth.onboarding');
  return (
    <AuthShell
      title={editing ? t('editTitle') : t('title')}
      description={editing ? t('editDescription') : t('description')}
    >
      <RecordLastMethod />
      <OnboardingFlow
        user={session.user}
        destination={destination}
        hasAccess={hasAccess}
        initialStep={editing ? 'access' : 'profile'}
        request={
          request
            ? {
                status: request.status,
                businessName: request.businessName,
                website: request.website,
                phone: request.phone,
                message: request.message
              }
            : null
        }
      />
    </AuthShell>
  );
}
