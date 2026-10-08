import Link from 'next/link';
import AuthShell from './auth-shell';
import UserAuthForm from './user-auth-form';

export default function SignUpViewPage({ next }: { next?: string }) {
  return (
    <AuthShell
      title='Créer un compte'
      description='Votre accès LevelUp pour gérer votre site, vos réservations et vos demandes.'
    >
      <UserAuthForm mode='sign-up' next={next} />
      <p className='text-muted-foreground text-center text-sm'>
        Déjà un compte ?{' '}
        <Link href='/auth/sign-in' className='hover:text-primary underline underline-offset-4'>
          Se connecter
        </Link>
      </p>
    </AuthShell>
  );
}
