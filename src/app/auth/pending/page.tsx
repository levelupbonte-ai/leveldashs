import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AuthShell from '@/features/auth/components/auth-shell';
import {
  PendingAccountView,
  RejectedAccountView
} from '@/features/auth/components/pending-account-view';
import { RecordLastMethod } from '@/features/auth/components/record-last-method';
import {
  getAccessRequest,
  hasDashboardAccess,
  ONBOARDING_PATH,
  PENDING_PATH
} from '@/lib/auth/access';
import { getAuthMethods } from '@/lib/auth/auth-methods';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { getDashboardSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Compte en cours de vérification',
  description: 'Votre demande d’accès au tableau de bord LevelUp.'
};

// Where every sign-in (password, Google, passkey, e-mail link, /dashboard)
// lands while the access request waits for the LevelUp team, or was rejected.
export default async function Page() {
  const session = await getDashboardSession();
  if (!session) redirect(`/auth/sign-in?next=${encodeURIComponent(PENDING_PATH)}`);

  const db = await createClient();
  const {
    data: { user }
  } = await db.auth.getUser();
  if (await needsMfaChallenge(db, user)) redirect(mfaChallengeUrl(PENDING_PATH));

  if (hasDashboardAccess(session)) redirect('/dashboard/site');
  const request = await getAccessRequest(session.user.id);
  if (!request || request.status === 'approved') redirect(ONBOARDING_PATH);

  if (request.status === 'rejected') {
    return (
      <AuthShell
        title='Demande non retenue'
        description='Votre demande d’accès au tableau de bord n’a pas été validée.'
      >
        <RecordLastMethod />
        <RejectedAccountView email={session.user.email} businessName={request.businessName} />
      </AuthShell>
    );
  }

  const { passkey } = await getAuthMethods();
  return (
    <AuthShell
      title='Votre compte est en cours de vérification'
      description='Merci ! L’équipe LevelUp vérifie chaque accès au tableau de bord avant de l’ouvrir.'
    >
      <RecordLastMethod />
      <PendingAccountView
        email={session.user.email}
        businessName={request.businessName}
        submittedAt={request.createdAt}
        mfaEnabled={session.mfa.enabled}
        passkeyEnabled={passkey}
      />
    </AuthShell>
  );
}
