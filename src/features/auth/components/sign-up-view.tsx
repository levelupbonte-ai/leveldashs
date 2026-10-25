import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { AuthMethods } from '@/lib/auth/auth-methods';
import AuthShell from './auth-shell';
import UserAuthForm from './user-auth-form';

export default async function SignUpViewPage({
  next,
  methods,
  lockedEmail = null
}: {
  next?: string;
  methods: AuthMethods;
  lockedEmail?: string | null;
}) {
  const t = await getTranslations('auth.signUp');
  return (
    <AuthShell title={t('title')} description={t('description')}>
      <UserAuthForm mode='sign-up' next={next} methods={methods} lockedEmail={lockedEmail} />
      {!lockedEmail && next === '/auth/activate' && (
        <p className='bg-muted/40 text-muted-foreground rounded-lg border p-3 text-center text-xs'>
          {t('codeNext')}
        </p>
      )}
      {!lockedEmail && next !== '/auth/activate' && (
        <p className='bg-muted/40 text-muted-foreground rounded-lg border p-3 text-center text-xs'>
          {t('haveCode')}{' '}
          <Link
            href={`/auth/sign-up?next=${encodeURIComponent('/auth/activate')}`}
            className='hover:text-primary font-medium underline underline-offset-4'
          >
            {t('haveCodeLink')}
          </Link>
        </p>
      )}
      <p className='text-muted-foreground text-center text-sm'>
        {t('haveAccount')}{' '}
        <Link
          href={next ? `/auth/sign-in?next=${encodeURIComponent(next)}` : '/auth/sign-in'}
          className='hover:text-primary underline underline-offset-4'
        >
          {t('signIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
