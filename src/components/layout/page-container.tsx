import React from 'react';
import { Heading } from '../ui/heading';
import type { InfobarContent } from '@/components/ui/infobar';
import { useTranslations } from 'next-intl';

function PageSkeleton() {
  const t = useTranslations('common');
  return (
    <div
      role='status'
      aria-label={t('loading')}
      className='flex flex-1 animate-pulse flex-col gap-4 p-4 md:px-6'
    >
      <div className='flex items-center justify-between'>
        <div className='w-full'>
          <div className='bg-muted mb-2 h-8 w-48 max-w-full rounded' />
          <div className='bg-muted h-4 w-96 max-w-full rounded' />
        </div>
      </div>
      <div className='bg-muted mt-6 h-40 w-full rounded-lg' />
      <div className='bg-muted h-40 w-full rounded-lg' />
    </div>
  );
}

function NoAccess() {
  const t = useTranslations('common');
  return <div className='text-muted-foreground text-center text-lg'>{t('noAccess')}</div>;
}

export default function PageContainer({
  children,
  isLoading = false,
  access = true,
  accessFallback,
  pageTitle,
  pageDescription,
  infoContent,
  pageHeaderAction
}: {
  children: React.ReactNode;
  isLoading?: boolean;
  access?: boolean;
  accessFallback?: React.ReactNode;
  pageTitle?: string;
  pageDescription?: string;
  infoContent?: InfobarContent;
  pageHeaderAction?: React.ReactNode;
}) {
  if (!access) {
    return (
      <div role='status' className='flex flex-1 items-center justify-center p-4 md:px-6'>
        {accessFallback ?? <NoAccess />}
      </div>
    );
  }

  const content = isLoading ? <PageSkeleton /> : children;

  const hasHeader = pageTitle || pageHeaderAction;

  return (
    <div className='flex min-w-0 flex-1 flex-col px-4 pt-2 pb-4 md:px-6 md:pt-4'>
      {hasHeader && (
        <div className='mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3'>
          <Heading
            title={pageTitle ?? ''}
            description={pageDescription ?? ''}
            infoContent={infoContent}
          />
          {pageHeaderAction && (
            <div className='flex max-w-full flex-wrap items-center gap-2'>{pageHeaderAction}</div>
          )}
        </div>
      )}
      {content}
    </div>
  );
}
