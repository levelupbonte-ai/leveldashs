'use client';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { formatMoney } from '@/features/billing/lib/format';
import { useErrorMessage } from '@/hooks/use-error-message';
import { createClient } from '@/lib/supabase/client';
import { decideUpgradeRequest } from '../../api/billing';
import { billingOrgsQueryOptions, upgradeRequestsQueryOptions } from '../../api/queries';
import type { BillingOrgRow, UpgradeRequestRow } from '../../api/types';
import { useRefreshBilling } from './charge-dialogs';
import { ConfirmDialog } from './confirm-dialog';
import { OrgBillingSheet } from './org-billing-sheet';

/** Staff: every organization with its plan, price state and amount due. */
export function BillingOrgs() {
  const { data } = useSuspenseQuery(billingOrgsQueryOptions(createClient()));
  const t = useTranslations('admin.billing.orgs');
  const tPrice = useTranslations('admin.billing.price');
  const tStatus = useTranslations('billing.status');
  const format = useFormatter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? data.filter((o) => o.organization_name.toLowerCase().includes(s)) : data;
  }, [data, q]);

  const price = (o: BillingOrgRow) =>
    o.price === null
      ? tPrice('unset')
      : o.price_state === 'free'
        ? tPrice('free')
        : formatMoney(format.number, o.price, o.currency);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <Input
          placeholder={t('search')}
          value={q}
          maxLength={100}
          onChange={(e) => setQ(e.target.value)}
          className='max-w-sm'
          aria-label={t('search')}
        />
        {rows.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('empty')}</p>
        ) : (
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('organization')}</TableHead>
                  <TableHead>{t('plan')}</TableHead>
                  <TableHead>{t('price')}</TableHead>
                  <TableHead>{t('due')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.organization_id}>
                    <TableCell>
                      <div className='font-medium'>{o.organization_name}</div>
                      <div className='text-muted-foreground flex flex-wrap gap-x-2 text-xs'>
                        {o.pending_plan_key && (
                          <span className='text-amber-700 dark:text-amber-300'>
                            {t('requested', {
                              plan: o.pending_plan_name ?? o.pending_plan_key
                            })}
                          </span>
                        )}
                        {o.discount_count > 0 && (
                          <span>{t('discounts', { count: o.discount_count })}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{o.plan_name}</TableCell>
                    <TableCell className='tabular-nums'>
                      {price(o)}
                      {o.price_state === 'custom' && (
                        <Badge variant='outline' className='ml-2'>
                          {tPrice('custom')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {o.total_due.length === 0
                        ? '—'
                        : o.total_due.map((d) => (
                            <div key={d.currency}>
                              {formatMoney(format.number, d.amount, d.currency)}
                            </div>
                          ))}
                      {o.overdue_count > 0 && (
                        <div className='text-destructive text-xs'>
                          {t('overdue', { count: o.overdue_count })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          o.status === 'active'
                            ? 'secondary'
                            : o.status === 'trial'
                              ? 'outline'
                              : 'destructive'
                        }
                      >
                        {tStatus(o.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-right'>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => setOpen(o.organization_id)}
                      >
                        {t('manage')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <OrgBillingSheet organizationId={open} onOpenChange={(v) => !v && setOpen(null)} />
    </Card>
  );
}

/** Staff: plan changes asked from Billing. Approve sets the plan, decline closes it. */
export function UpgradeRequests() {
  const { data } = useSuspenseQuery(upgradeRequestsQueryOptions(createClient()));
  const t = useTranslations('admin.billing.requests');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const refresh = useRefreshBilling();
  const [deciding, setDeciding] = useState<{
    row: UpgradeRequestRow;
    approve: boolean;
  } | null>(null);
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      decideUpgradeRequest(createClient(), id, approve),
    onSuccess: async (_, v) => {
      toast.success(v.approve ? t('approved') : t('declined'));
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('empty')}</p>
        ) : (
          <ul className='divide-y rounded-lg border'>
            {data.map((r) => (
              <li key={r.id} className='flex flex-col gap-3 p-3 sm:flex-row sm:items-center'>
                <div className='min-w-0 flex-1 text-sm'>
                  <p className='font-medium'>
                    {r.organization_name}{' '}
                    <Badge
                      variant={
                        r.status === 'pending'
                          ? 'default'
                          : r.status === 'approved'
                            ? 'secondary'
                            : 'outline'
                      }
                      className='ml-1'
                    >
                      {t(`status.${r.status}`)}
                    </Badge>
                  </p>
                  <p className='text-muted-foreground'>
                    {t('from', {
                      from: r.from_plan_name ?? '—',
                      to: r.plan_name
                    })}{' '}
                    ·{' '}
                    {format.dateTime(new Date(r.created_at), {
                      dateStyle: 'medium'
                    })}
                    {r.requested_by_email ? ` · ${t('by', { email: r.requested_by_email })}` : ''}
                  </p>
                  {r.message && <p className='mt-1 break-words whitespace-pre-wrap'>{r.message}</p>}
                </div>
                {r.status === 'pending' && (
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      disabled={decide.isPending}
                      onClick={() => setDeciding({ row: r, approve: true })}
                    >
                      {t('approve')}
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={decide.isPending}
                      onClick={() => setDeciding({ row: r, approve: false })}
                    >
                      {t('decline')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!deciding}
        destructive={deciding ? !deciding.approve : false}
        title={deciding?.approve ? t('approve') : t('decline')}
        description={
          deciding
            ? deciding.approve
              ? t('approveConfirm', {
                  org: deciding.row.organization_name,
                  plan: deciding.row.plan_name
                })
              : t('declineConfirm', { org: deciding.row.organization_name })
            : ''
        }
        confirmLabel={deciding?.approve ? t('approve') : t('decline')}
        onConfirm={() =>
          deciding && decide.mutate({ id: deciding.row.id, approve: deciding.approve })
        }
        onOpenChange={(v) => !v && setDeciding(null)}
      />
    </Card>
  );
}
