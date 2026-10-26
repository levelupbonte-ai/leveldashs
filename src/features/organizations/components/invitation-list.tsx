'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { invitationState } from '@/lib/access/codes';
import { cn } from '@/lib/utils';
import type { Invitation } from '../api/service';

type Shown = 'sent' | 'failed' | 'pending' | 'accepted' | 'expired';

function shownStatus(inv: Invitation): Shown {
  const state = invitationState({
    acceptedAt: inv.accepted_at,
    revokedAt: inv.revoked_at,
    expiresAt: inv.expires_at
  });
  if (state === 'accepted') return 'accepted';
  if (state === 'expired') return 'expired';
  return inv.email_status;
}

const VARIANT: Record<Shown, string> = {
  sent: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  accepted: 'border-transparent bg-secondary text-secondary-foreground',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  pending: 'border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  expired: 'text-muted-foreground'
};

/** Pending and recently accepted invitations, with "Resend email" and "Revoke". */
export function InvitationList({
  invitations,
  canRevokeOwner,
  busy,
  onResend,
  onRevoke,
  className
}: {
  invitations: Invitation[];
  canRevokeOwner: boolean;
  busy: boolean;
  onResend: (inv: Invitation) => void;
  onRevoke: (inv: Invitation) => void;
  className?: string;
}) {
  const t = useTranslations('team');
  const tRole = useTranslations('common.roles');
  const format = useFormatter();
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t('invitationsTitle')}</CardTitle>
        <CardDescription>{t('invitationsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className='divide-y'>
        {invitations.length === 0 && (
          <p className='text-muted-foreground py-2 text-sm'>{t('noInvitations')}</p>
        )}
        {invitations.map((inv) => {
          const status = shownStatus(inv);
          const open = status !== 'accepted';
          return (
            <div key={inv.id} className='flex flex-col gap-2 py-3 sm:flex-row sm:items-center'>
              <div className='flex min-w-0 flex-1 items-center gap-3'>
                <div className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-full'>
                  <Icons.mail className='size-4' aria-hidden />
                </div>
                <div className='min-w-0'>
                  <p className='truncate font-medium'>{inv.email}</p>
                  <p className='text-muted-foreground text-xs'>
                    {tRole(inv.role)} ·{' '}
                    {status === 'accepted' && inv.accepted_at
                      ? t('acceptedOn', { date: date(inv.accepted_at) })
                      : status === 'expired'
                        ? t('expiredOn', { date: date(inv.expires_at) })
                        : inv.last_sent_at
                          ? t('sentOn', {
                              date: date(inv.last_sent_at),
                              expires: date(inv.expires_at)
                            })
                          : t('expiresOn', { date: date(inv.expires_at) })}
                  </p>
                </div>
              </div>
              <div className='flex items-center gap-2 pl-12 sm:pl-0'>
                <Badge variant='outline' className={cn(VARIANT[status])}>
                  {t(`invitationStatus.${status}`)}
                </Badge>
                {open && (
                  <Button size='sm' variant='outline' disabled={busy} onClick={() => onResend(inv)}>
                    <Icons.send className='size-4' aria-hidden />
                    {t('resend')}
                  </Button>
                )}
                {open && (inv.role !== 'owner' || canRevokeOwner) && (
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={busy}
                    aria-label={t('revokeFor', { email: inv.email })}
                    onClick={() => onRevoke(inv)}
                  >
                    {t('revoke')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
