import { redirect } from 'next/navigation';
import { getDashboardSession } from '@/lib/auth/session';

export default async function Page() {
  const session = await getDashboardSession();
  redirect(session ? '/dashboard/site' : '/auth/sign-in');
}
