import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
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
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { getDashboardSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.pending');
  return { title: t('metaTitle'), description: t('metaDescription') };
}

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
    const tr = await getTranslations('auth.rejected');
    return (
      <AuthShell title={tr('title')} description={tr('description')}>
        <RecordLastMethod />
        <RejectedAccountView email={session.user.email} businessName={request.businessName} />
      </AuthShell>
    );
  }

  const t = await getTranslations('auth.pending');
  return (
    <AuthShell title={t('title')} description={t('description')}>
      <RecordLastMethod />
      <PendingAccountView
        email={session.user.email}
        businessName={request.businessName}
        submittedAt={request.createdAt}
      />
    </AuthShell>
  );
}
