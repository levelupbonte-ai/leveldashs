import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { safeNext } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';
import SignUpViewPage from '@/features/auth/components/sign-up-view';

export const metadata: Metadata = {
  title: 'Créer un compte',
  description: 'Créer un compte LevelUp.'
};

export default async function Page(props: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await props.searchParams;
  const {
    data: { user }
  } = await (await createClient()).auth.getUser();
  if (user) redirect(safeNext(next));
  return <SignUpViewPage next={next} />;
}
