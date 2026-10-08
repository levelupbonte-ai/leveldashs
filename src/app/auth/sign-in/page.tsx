import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { safeNext } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';
import SignInViewPage from '@/features/auth/components/sign-in-view';

export const metadata: Metadata = {
  title: 'Connexion',
  description: 'Connexion au tableau de bord LevelUp.'
};

export default async function Page(props: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await props.searchParams;
  // Already signed in (single LevelUp session): go straight to the destination.
  const {
    data: { user }
  } = await (await createClient()).auth.getUser();
  if (user) redirect(safeNext(next));
  return <SignInViewPage next={next} error={error} />;
}
