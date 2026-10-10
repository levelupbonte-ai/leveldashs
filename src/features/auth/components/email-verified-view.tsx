import Link from 'next/link';
import { Icons } from '@/components/icons';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { AuthSteps } from './auth-steps';

/** Shown where the confirmation link was opened (often a phone). */
export function EmailVerifiedView({ next }: { next: string }) {
  const t = useTranslations('auth.verified');
  return (
    <div className='space-y-6' role='status'>
      <AuthSteps current={2} />
      <div className='mx-auto grid size-14 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'>
        <Icons.mailCheck className='size-7' aria-hidden />
      </div>
      <div className='space-y-3 rounded-lg border p-4 text-center text-sm'>
        <p className='flex items-center justify-center gap-2 font-medium'>
          <Icons.devices className='size-4 shrink-0' aria-hidden />
          {t('goBack')}
        </p>
        <p className='text-muted-foreground text-xs'>{t('goBackHint')}</p>
      </div>
      <Link href={next} className={buttonVariants({ variant: 'secondary', className: 'w-full' })}>
        {t('continueHere')}
      </Link>
    </div>
  );
}
