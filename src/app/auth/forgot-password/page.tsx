import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import AuthShell from '@/features/auth/components/auth-shell';
import ForgotPasswordForm from '@/features/auth/components/forgot-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.forgot');
  return { title: t('title'), description: t('metaDescription') };
}

export default async function Page() {
  const t = await getTranslations('auth.forgot');
  return (
    <AuthShell title={t('title')} description={t('description')}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
