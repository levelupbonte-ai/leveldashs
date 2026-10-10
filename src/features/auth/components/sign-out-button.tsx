'use client';
import { useFormStatus } from 'react-dom';
import { Icons } from '@/components/icons';
import { LoadingButton } from '@/components/ui/loading-button';
import { useTranslations } from 'next-intl';
import { signOut } from '@/lib/auth/actions';

function Submit({ className }: { className?: string }) {
  const { pending } = useFormStatus();
  const t = useTranslations('auth.signOut');
  return (
    <LoadingButton
      type='submit'
      variant='ghost'
      loading={pending}
      loadingLabel={t('loading')}
      className={className}
    >
      <Icons.logout className='size-4' aria-hidden />
      {t('label')}
    </LoadingButton>
  );
}

/** "Sign out": signs out of Supabase (server action), then the sign-in page. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOut} className='w-full'>
      <Submit className={className} />
    </form>
  );
}
