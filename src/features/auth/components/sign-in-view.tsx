import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { AuthMethods } from '@/lib/auth/auth-methods';
import AuthShell from './auth-shell';
import UserAuthForm from './user-auth-form';

export default async function SignInViewPage({
  next,
  error,
  methods
}: {
  next?: string;
  error?: string;
  methods: AuthMethods;
}) {
  const t = await getTranslations('auth.signIn');
  return (
    <AuthShell title={t('title')} description={t('description')}>
      <UserAuthForm mode='sign-in' next={next} initialError={error} methods={methods} />
      <p className='text-muted-foreground text-center text-sm'>
        {t('noAccount')}{' '}
        <Link href='/auth/sign-up' className='hover:text-primary underline underline-offset-4'>
          {t('createAccount')}
        </Link>
      </p>
    </AuthShell>
  );
}
