import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AuthShell from '@/features/auth/components/auth-shell';
import OnboardingFlow from '@/features/auth/components/onboarding-flow';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { safeNext } from '@/lib/auth/redirect';
import { getDashboardSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Finaliser mon compte',
  description: 'Votre profil et votre accès au tableau de bord LevelUp.'
};

export default async function Page(props: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await props.searchParams;
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

  const hasAccess = session.isPlatformAdmin || session.organizations.length > 0;
  const { data: request } = await db
    .from('access_requests')
    .select('status, business_name, website, phone, message')
    .eq('user_id', session.user.id)
    .maybeSingle();

  const pending = !hasAccess && request?.status === 'pending';
  const rejected = !hasAccess && request?.status === 'rejected';
  return (
    <AuthShell
      title={
        pending
          ? 'Demande en cours de vérification'
          : rejected
            ? 'Demande non retenue'
            : 'Finaliser votre compte'
      }
      description={
        pending
          ? 'L’équipe LevelUp vérifie chaque accès au tableau de bord.'
          : rejected
            ? 'Votre demande d’accès au tableau de bord n’a pas été validée.'
            : 'Quelques informations pour personnaliser votre espace.'
      }
    >
      <OnboardingFlow
        user={session.user}
        destination={destination}
        hasAccess={hasAccess}
        mfaEnabled={session.mfa.enabled}
        request={
          request
            ? {
                status: request.status as 'pending' | 'approved' | 'rejected',
                businessName: request.business_name,
                website: request.website ?? '',
                phone: request.phone ?? '',
                message: request.message ?? ''
              }
            : null
        }
      />
    </AuthShell>
  );
}
