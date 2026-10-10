import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import PageContainer from '@/components/layout/page-container';
import { getAuthMethods } from '@/lib/auth/auth-methods';
import ProfileViewPage from '@/features/profile/components/profile-view-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profile');
  return { title: t('title') };
}

export default async function Page(props: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await props.searchParams;
  const { passkey } = await getAuthMethods();
  const t = await getTranslations('profile');
  return (
    <PageContainer pageTitle={t('title')} pageDescription={t('description')}>
      <ProfileViewPage passwordReset={reset === '1'} passkeyEnabled={passkey} />
    </PageContainer>
  );
}
