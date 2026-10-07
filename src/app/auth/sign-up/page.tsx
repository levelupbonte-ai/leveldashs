import { Metadata } from 'next';
import SignUpViewPage from '@/features/auth/components/sign-up-view';

export const metadata: Metadata = {
  title: 'Créer un compte',
  description: 'Créer un compte LevelUp.'
};

export default async function Page(props: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await props.searchParams;
  return <SignUpViewPage next={next} />;
}
