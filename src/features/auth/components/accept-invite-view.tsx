'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button, buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { emailsMatch, type InvitationPreview } from '@/lib/access/codes';
import { setActiveOrganization } from '@/lib/auth/actions';
import { SignOutButton } from './sign-out-button';

type AcceptStatus =
  | 'accepted'
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'used'
  | 'email_mismatch'
  | 'email_unconfirmed'
  | 'rate_limited'
  | 'failed';

async function acceptInvitation(token: string) {
  const res = await fetch('/api/team/invitations/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  }).catch(() => null);
  if (!res) return { status: 'failed' as AcceptStatus };
  const body = (await res.json().catch(() => ({}))) as {
    status?: AcceptStatus;
    error?: string;
    organizationId?: string | null;
    organizationName?: string | null;
  };
  if (!res.ok)
    return { status: (body.error === 'rateLimited' ? 'rate_limited' : 'failed') as AcceptStatus };
  return { ...body, status: body.status ?? 'failed' };
}

function Message({
  icon,
  title,
  children
}: {
  icon: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className='bg-card flex gap-3 rounded-xl border p-4 shadow-xs' role='status'>
      <div className='bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-full'>
        {icon}
      </div>
      <div className='min-w-0 space-y-1 text-sm'>
        {title && <p className='font-semibold'>{title}</p>}
        <div className='text-muted-foreground'>{children}</div>
      </div>
    </div>
  );
}

export function AcceptInviteView({
  token,
  preview,
  signedInEmail,
  self,
  autoAccept = true
}: {
  token: string | null;
  preview: InvitationPreview;
  signedInEmail: string | null;
  /** This page's path with the token, for sign-in / sign-up `next`. */
  self: string;
  /** Screenshot harness only: show a state without calling the server. */
  autoAccept?: boolean;
}) {
  const t = useTranslations('auth.acceptInvite');
  const tRole = useTranslations('common.roles');
  const format = useFormatter();
  const router = useRouter();
  const [result, setResult] = useState<AcceptStatus | null>(null);
  const started = useRef(false);

  const details = preview.status === 'valid' || preview.status === 'accepted' ? preview : null;
  const matches = !!details && emailsMatch(details.email, signedInEmail);

  const accept = useCallback(async () => {
    if (!token) return;
    const out = await acceptInvitation(token);
    if (out.status === 'accepted') {
      if (out.organizationId)
        await setActiveOrganization(out.organizationId).catch(() => undefined);
      toast.success(
        t('welcome', { organization: out.organizationName ?? details?.organization_name ?? '' })
      );
      router.replace('/dashboard/site');
      router.refresh();
      return;
    }
    setResult(out.status);
  }, [token, router, t, details?.organization_name]);

  // Signed in with the invited address: accept straight away, once.
  useEffect(() => {
    if (!autoAccept || started.current || !token || !signedInEmail) return;
    if (preview.status === 'valid' ? !matches : preview.status !== 'accepted') return;
    started.current = true;
    void accept();
  }, [autoAccept, token, signedInEmail, preview.status, matches, accept]);

  const status: string = result ?? preview.status;
  const dashboard = (
    <Link href='/dashboard/site' className={buttonVariants({ className: 'w-full' })}>
      {t('goDashboard')}
    </Link>
  );

  if (status === 'invalid' || status === 'revoked' || status === 'used' || status === 'expired') {
    return (
      <div className='space-y-4'>
        <Message
          icon={
            status === 'expired' ? (
              <Icons.hourglass className='size-5' />
            ) : (
              <Icons.circleX className='size-5' />
            )
          }
          title={t(`${status}Title`)}
        >
          {t(status)}
        </Message>
        {signedInEmail ? (
          dashboard
        ) : (
          <Link
            href='/auth/sign-in'
            className={buttonVariants({ variant: 'outline', className: 'w-full' })}
          >
            {t('signIn')}
          </Link>
        )}
      </div>
    );
  }

  const summary = details && (
    <div className='bg-card space-y-3 rounded-xl border p-4 text-sm shadow-xs'>
      <div className='flex items-center gap-3'>
        <div className='bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-full'>
          <Icons.teams className='size-5' aria-hidden />
        </div>
        <div className='min-w-0'>
          <p className='font-semibold break-words'>{details.organization_name}</p>
          {details.website_name && (
            <p className='text-muted-foreground text-xs break-all'>{details.website_name}</p>
          )}
        </div>
      </div>
      <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1'>
        <dt className='text-muted-foreground'>{t('invitedBy')}</dt>
        <dd className='font-medium break-words'>{details.inviter_name}</dd>
        <dt className='text-muted-foreground'>{t('role')}</dt>
        <dd className='font-medium'>{tRole(details.role)}</dd>
        <dt className='text-muted-foreground'>{t('forEmail')}</dt>
        <dd className='font-medium break-all'>{details.email}</dd>
        <dt className='text-muted-foreground'>{t('validUntil')}</dt>
        <dd>{format.dateTime(new Date(details.expires_at), { dateStyle: 'medium' })}</dd>
      </dl>
    </div>
  );

  // Signed out: sign in or create the account with the invited address.
  if (!signedInEmail) {
    const next = encodeURIComponent(self);
    return (
      <div className='space-y-4'>
        {summary}
        <p className='text-muted-foreground text-sm'>{t('needAccount')}</p>
        <div className='grid gap-2'>
          <Link
            href={`/auth/sign-in?next=${next}`}
            className={buttonVariants({ className: 'w-full' })}
          >
            <Icons.login className='size-4' aria-hidden />
            {t('signInCta')}
          </Link>
          <Link
            href={`/auth/sign-up?next=${next}`}
            className={buttonVariants({ variant: 'outline', className: 'w-full' })}
          >
            {t('signUpCta')}
          </Link>
        </div>
      </div>
    );
  }

  if ((details && !matches && preview.status === 'valid') || status === 'email_mismatch') {
    return (
      <div className='space-y-4'>
        {summary}
        <Message icon={<Icons.warning className='size-5' />} title={t('mismatchTitle')}>
          {t('mismatch', { invited: details?.email ?? '', current: signedInEmail })}
        </Message>
        <SignOutButton className='w-full' />
      </div>
    );
  }

  if (status === 'email_unconfirmed' || status === 'rate_limited' || status === 'failed') {
    return (
      <div className='space-y-4'>
        {summary}
        <Message icon={<Icons.alertCircle className='size-5' />}>
          {t(
            status === 'email_unconfirmed'
              ? 'unconfirmed'
              : status === 'rate_limited'
                ? 'rateLimited'
                : 'failed'
          )}
        </Message>
        <Button
          className='w-full'
          onClick={() => {
            setResult(null);
            void accept();
          }}
        >
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {summary}
      <p
        className='text-muted-foreground flex items-center justify-center gap-2 text-sm'
        role='status'
      >
        <Spinner className='size-4' />
        {t('accepting', { organization: details?.organization_name ?? '' })}
      </p>
    </div>
  );
}
