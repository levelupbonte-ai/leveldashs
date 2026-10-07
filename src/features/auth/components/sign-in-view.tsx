import Link from 'next/link';
import AuthShell from './auth-shell';
import UserAuthForm from './user-auth-form';

export default function SignInViewPage({ next, error }: { next?: string; error?: string }) {
  return (
    <AuthShell title='Connexion' description='Accédez au tableau de bord de votre site.'>
      <UserAuthForm mode='sign-in' next={next} initialError={error} />
      <p className='text-muted-foreground text-center text-sm'>
        Pas encore de compte ?{' '}
        <Link href='/auth/sign-up' className='hover:text-primary underline underline-offset-4'>
          Créer un compte
        </Link>
      </p>
    </AuthShell>
  );
}
