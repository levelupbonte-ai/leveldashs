'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { SignOutDialog } from './sign-out-dialog';

/** "Sign out": asks for confirmation, then signs out (server action) to the sign-in page. */
export function SignOutButton({ className }: { className?: string }) {
  const t = useTranslations('auth.signOut');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type='button' variant='ghost' className={className} onClick={() => setOpen(true)}>
        <Icons.logout className='size-4' aria-hidden />
        {t('label')}
      </Button>
      <SignOutDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
