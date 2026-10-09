'use client';
import { useFormStatus } from 'react-dom';
import { Icons } from '@/components/icons';
import { LoadingButton } from '@/components/ui/loading-button';
import { signOut } from '@/lib/auth/actions';

function Submit({ className }: { className?: string }) {
  const { pending } = useFormStatus();
  return (
    <LoadingButton
      type='submit'
      variant='ghost'
      loading={pending}
      loadingLabel='Déconnexion…'
      className={className}
    >
      <Icons.logout className='size-4' aria-hidden />
      Se déconnecter
    </LoadingButton>
  );
}

/** "Se déconnecter": signs out of Supabase (server action), then the sign-in page. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOut} className='w-full'>
      <Submit className={className} />
    </form>
  );
}
