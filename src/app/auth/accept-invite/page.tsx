import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import AuthShell from '@/features/auth/components/auth-shell';
import { AcceptInviteView } from '@/features/auth/components/accept-invite-view';
import { isInviteToken } from '@/lib/access/codes';
import { getInvitationPreview } from '@/lib/access/server';
import { mfaChallengeUrl, needsMfaChallenge } from '@/lib/auth/mfa';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.acceptInvite');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

// Link of the team invitation e-mail. Signed out: sign in or create an account
// with the invited address (prefilled and locked). Signed in with that address:
// accepted right away (the database checks the token, expiry, single use, the
// confirmed e-mail and that it is the invited one).
export default async function Page(props: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await props.searchParams;
  const db = await createClient();
  const {
    data: { user }
  } = await db.auth.getUser();
  const self = `/auth/accept-invite?token=${encodeURIComponent(isInviteToken(token) ? token : '')}`;
  if (user && (await needsMfaChallenge(db, user))) redirect(mfaChallengeUrl(self));
  const preview = await getInvitationPreview(db, token);
  const t = await getTranslations('auth.acceptInvite');
  const title =
    preview.status === 'valid' || preview.status === 'accepted'
      ? t('title', { organization: preview.organization_name })
      : t(`${preview.status}Title`);
  return (
    <AuthShell title={title} description={t('description')}>
      <AcceptInviteView
        token={isInviteToken(token) ? token : null}
        preview={preview}
        signedInEmail={user?.email ?? null}
        self={self}
      />
    </AuthShell>
  );
}
