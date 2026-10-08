import PageContainer from '@/components/layout/page-container';
import ProfileViewPage from '@/features/profile/components/profile-view-page';

export const metadata = {
  title: 'Mon profil'
};

export default async function Page(props: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await props.searchParams;
  return (
    <PageContainer
      pageTitle='Mon profil'
      pageDescription='Votre nom, votre mot de passe et la sécurité du compte'
    >
      <ProfileViewPage passwordReset={reset === '1'} />
    </PageContainer>
  );
}
