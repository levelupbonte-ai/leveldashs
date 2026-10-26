'use client';

import { useTranslations } from 'next-intl';
import { useRef, useTransition } from 'react';
import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { LoadingButton } from '@/components/ui/loading-button';
import { signOut } from '@/lib/auth/actions';

export interface SignOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Sign out of LevelUp?" confirmation used by every sign-out entry point.
 * Focus starts on Cancel; while the server action runs the dialog stays open
 * with a loading state, then the action redirects to the sign-in page.
 */
export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const t = useTranslations('auth.signOut');
  const [pending, startTransition] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Icons.logout aria-hidden />
          </AlertDialogMedia>
          <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('confirmDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={pending}>
            {t('cancel')}
          </AlertDialogCancel>
          <LoadingButton
            loading={pending}
            loadingLabel={t('loading')}
            onClick={() =>
              startTransition(async () => {
                await signOut();
              })
            }
          >
            {t('confirm')}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
