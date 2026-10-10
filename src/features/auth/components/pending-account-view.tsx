import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { SignOutButton } from './sign-out-button';

const CONTACT = 'contact@levelup-ecosystem.com';

function RequestSummary({
  businessName,
  detail,
  icon
}: {
  businessName: string;
  detail: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className='bg-card flex items-center gap-3 rounded-xl border p-4 shadow-xs'>
      <div className='bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-full'>
        {icon}
      </div>
      <div className='min-w-0 flex-1'>
        <p className='font-semibold break-words'>{businessName}</p>
        <p className='text-muted-foreground text-xs'>{detail}</p>
      </div>
    </div>
  );
}

function ContactLine({ label }: { label: string }) {
  return (
    <p className='text-muted-foreground text-center text-xs'>
      {label}{' '}
      <a href={`mailto:${CONTACT}`} className='hover:text-primary underline underline-offset-4'>
        {CONTACT}
      </a>
    </p>
  );
}

/** Signed-in account whose access request waits for the LevelUp team. */
export async function PendingAccountView({
  email,
  businessName,
  submittedAt
}: {
  email: string;
  businessName: string;
  submittedAt: string | null;
}) {
  const t = await getTranslations('auth.pending');
  const format = await getFormatter();
  const date = submittedAt ? new Date(submittedAt) : null;
  const sent =
    date && !Number.isNaN(date.getTime())
      ? t('submittedOn', { date: format.dateTime(date, { dateStyle: 'long' }) })
      : t('submitted');

  return (
    <div className='space-y-5' role='status'>
      <RequestSummary
        businessName={businessName || t('yourBusiness')}
        detail={sent}
        icon={<Icons.hourglass className='size-5' aria-hidden />}
      />
      <dl className='space-y-3 text-sm'>
        <div className='flex gap-3'>
          <Icons.clock className='text-muted-foreground mt-0.5 size-4 shrink-0' aria-hidden />
          <div>
            <dt className='font-medium'>{t('delayTitle')}</dt>
            <dd className='text-muted-foreground'>{t('delay')}</dd>
          </div>
        </div>
        <div className='flex gap-3'>
          <Icons.mail className='text-muted-foreground mt-0.5 size-4 shrink-0' aria-hidden />
          <div className='min-w-0'>
            <dt className='font-medium'>{t('emailTitle')}</dt>
            <dd className='text-muted-foreground break-words'>
              {t.rich('email', {
                email: () => <strong className='text-foreground break-all'>{email}</strong>
              })}
            </dd>
          </div>
        </div>
      </dl>
      <div className='grid gap-2'>
        <Link
          href='/auth/onboarding?edit=1'
          className={buttonVariants({ variant: 'outline', className: 'w-full' })}
        >
          <Icons.edit className='size-4' aria-hidden />
          {t('edit')}
        </Link>
        <SignOutButton className='text-muted-foreground w-full' />
      </div>
      <ContactLine label={t('question')} />
    </div>
  );
}

/** Access request turned down by the LevelUp team. */
export async function RejectedAccountView({
  email,
  businessName
}: {
  email: string;
  businessName: string;
}) {
  const t = await getTranslations('auth.rejected');
  return (
    <div className='space-y-5' role='status'>
      <RequestSummary
        businessName={businessName || t('yourBusiness')}
        detail={<span className='break-all'>{email}</span>}
        icon={<Icons.circleX className='size-5' aria-hidden />}
      />
      <div className='grid gap-2'>
        <a
          href={`mailto:${CONTACT}`}
          className={buttonVariants({ variant: 'default', className: 'w-full' })}
        >
          <Icons.mail className='size-4' aria-hidden />
          {t('contact')}
        </a>
        <SignOutButton className='text-muted-foreground w-full' />
      </div>
    </div>
  );
}
