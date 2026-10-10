import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { AuthMethods } from '@/lib/auth/auth-methods';
import AuthShell from './auth-shell';
import UserAuthForm from './user-auth-form';

export default async function SignUpViewPage({
  next,
  methods
}: {
  next?: string;
  methods: AuthMethods;
}) {
  const t = await getTranslations('auth.signUp');
  return (
    <AuthShell title={t('title')} description={t('description')}>
      <UserAuthForm mode='sign-up' next={next} methods={methods} />
      <p className='text-muted-foreground text-center text-sm'>
        {t('haveAccount')}{' '}
        <Link href='/auth/sign-in' className='hover:text-primary underline underline-offset-4'>
          {t('signIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
