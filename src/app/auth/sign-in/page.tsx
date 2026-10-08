import { Metadata } from 'next';
import SignInViewPage from '@/features/auth/components/sign-in-view';

export const metadata: Metadata = {
  title: 'Connexion',
  description: 'Connexion au tableau de bord LevelUp.'
};

export default async function Page(props: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await props.searchParams;
  return <SignInViewPage next={next} error={error} />;
}
