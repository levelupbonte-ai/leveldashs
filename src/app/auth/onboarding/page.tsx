import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AuthShell from '@/features/auth/components/auth-shell';
import OnboardingFlow from '@/features/auth/components/onboarding-flow';
import { RecordLastMethod } from '@/features/auth/components/record-last-method';
import { getAccessRequest, hasDashboardAccess, PENDING_PATH } from '@/lib/auth/access';
import { getAuthMethods } from '@/lib/auth/auth-methods';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { isExternalNext, safeNext } from '@/lib/auth/redirect';
import { getDashboardSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Finaliser mon compte',
  description: 'Votre profil et votre accès au tableau de bord LevelUp.'
};

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

  const { passkey } = await getAuthMethods();
  return (
    <AuthShell
      title={editing ? 'Modifier ma demande' : 'Finaliser votre compte'}
      description={
        editing
          ? 'Mettez à jour les informations transmises à l’équipe LevelUp.'
          : 'Quelques informations pour personnaliser votre espace.'
      }
    >
      <RecordLastMethod />
      <OnboardingFlow
        user={session.user}
        destination={destination}
        hasAccess={hasAccess}
        mfaEnabled={session.mfa.enabled}
        passkeyEnabled={passkey}
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
