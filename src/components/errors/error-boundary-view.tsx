'use client';
import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { ErrorScreen, LEVELUP_SITE, SUPPORT_EMAIL } from './error-screen';

/**
 * Body of the `error.tsx` boundaries. The error is reported to Sentry; the page
 * only shows a generic text and the digest as a support reference (production
 * never exposes messages or stack traces of server errors).
 */
export function ErrorBoundaryView({
  error,
  reset,
  className
}: {
  error: Error & { digest?: string };
  reset: () => void;
  className?: string;
}) {
  const t = useTranslations('errorPage');
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <ErrorScreen
      className={className}
      code='500'
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('description')}
      reference={error.digest ? t('reference', { digest: error.digest }) : undefined}
      actions={
        <>
          <Button size='lg' onClick={() => reset()}>
            {t('retry')}
          </Button>
          <Link href='/' className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            {t('home')}
          </Link>
        </>
      }
      footer={
        <>
          <a
            href={LEVELUP_SITE}
            className='hover:text-foreground underline-offset-4 hover:underline'
          >
            {t('site')}
          </a>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className='hover:text-foreground underline-offset-4 hover:underline'
          >
            {t('contact')}
          </a>
        </>
      }
    />
  );
}
