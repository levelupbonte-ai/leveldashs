import PageContainer from '@/components/layout/page-container';
import ProfileViewPage from '@/features/profile/components/profile-view-page';

export const metadata = {
  title: 'Mon profil'
};

export default async function Page(props: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await props.searchParams;
  return (
    <PageContainer pageTitle='Mon profil' pageDescription='Votre nom et votre mot de passe'>
      <ProfileViewPage passwordReset={reset === '1'} />
    </PageContainer>
  );
}
