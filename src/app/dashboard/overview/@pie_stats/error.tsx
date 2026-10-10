'use client';

import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { StatsErrorAlert } from '@/features/overview/components/stats-error';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useTransition } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function PieStatsError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const t = useTranslations('statsError');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // Defer the refresh until the next render phase so React settles pending states first
  const retry = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <StatsErrorAlert
      message={t('loadFailed')}
      action={
        <>
          <Button variant='outline' size='sm' onClick={retry} disabled={isPending}>
            {isPending ? (
              <>
                <Icons.spinner className='mr-2 h-4 w-4 animate-spin' aria-hidden='true' />
                {t('retrying')}
              </>
            ) : (
              t('retry')
            )}
          </Button>
          <span role='status' aria-live='polite' className='sr-only'>
            {isPending ? t('retrying') : ''}
          </span>
        </>
      }
    />
  );
}
