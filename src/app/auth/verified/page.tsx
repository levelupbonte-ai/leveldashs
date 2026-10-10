import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import AuthShell from '@/features/auth/components/auth-shell';
import { EmailVerifiedView } from '@/features/auth/components/email-verified-view';
import { safeNext } from '@/lib/auth/redirect';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.verified');
  return { title: t('metaTitle'), description: t('description') };
}

// Landing page of the sign-up confirmation link (after /auth/callback created the
// session on this device). The sign-up tab on the first device moves on by itself.
export default async function Page(props: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await props.searchParams;
  const t = await getTranslations('auth.verified');
  return (
    <AuthShell title={t('title')} description={t('description')}>
      <EmailVerifiedView next={safeNext(next, '/auth/onboarding')} />
    </AuthShell>
  );
}
