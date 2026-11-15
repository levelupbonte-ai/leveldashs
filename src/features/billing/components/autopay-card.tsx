'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import { createClient } from '@/lib/supabase/client';
import { autopayQueryOptions, billingKeys } from '../api/queries';
import { autopayAction } from '../api/service';
import type { AutopayAction, AutopayState, BillingSummary } from '../api/types';
import { formatMoney } from '../lib/format';

const BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  jcb: 'JCB',
  diners: 'Diners Club',
  unionpay: 'UnionPay'
};

/**
 * Automatic monthly payment of the plan: Stripe keeps the card and charges it
 * each month; the client sees the card's brand and last 4 digits, the next
 * charge, and can change the card, download invoices, switch plan, or stop the
 * renewal (the plan stays until the end of the paid month).
 */
export function AutopayCard({
  summary,
  organizationId
}: {
  summary: BillingSummary;
  organizationId: string;
}) {
  const t = useTranslations('billing.autopay');
  const format = useFormatter();
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const { data, isPending, refetch } = useQuery(
    autopayQueryOptions(createClient(), organizationId)
  );
  const [busy, setBusy] = useState<AutopayAction | null>(null);
  const [confirm, setConfirm] = useState(false);
  const paid = summary.plans.filter((p) => (p.price ?? 0) > 0 && p.currency);
  const current = paid.find((p) => p.key === summary.plan.key);
  const [planKey, setPlanKey] = useState<string>(
    current?.key ?? paid[1]?.key ?? paid[0]?.key ?? ''
  );

  // Back from Stripe: say what happened and wait for the webhook to record it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const back = params.get('autopay');
    if (!back) return;
    params.delete('autopay');
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${params.size ? `?${params}` : ''}`
    );
    if (back === 'cancelled') {
      toast(t('backCancelled'));
      return;
    }
    toast.success(t('backOn'));
    let tries = 0;
    const timer = window.setInterval(async () => {
      tries += 1;
      const fresh = await refetch();
      if (fresh.data?.on || tries >= 10) {
        window.clearInterval(timer);
        void queryClient.invalidateQueries({ queryKey: billingKeys.org(organizationId) });
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [organizationId, queryClient, refetch, t]);

  if (!paid.length) return null;

  const run = async (action: AutopayAction, plan?: string) => {
    setBusy(action);
    try {
      const out = await autopayAction(organizationId, action, { planKey: plan, locale });
      if (out.url) {
        window.location.assign(out.url);
        return;
      }
      toast.success(t(`done.${action}`));
      await queryClient.invalidateQueries({ queryKey: billingKeys.org(organizationId) });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardDescription className='flex items-center gap-2'>
          <Icons.creditCard className='size-4' aria-hidden />
          {t('kicker')}
        </CardDescription>
        <CardTitle className='flex flex-wrap items-center gap-2 text-xl'>
          {data?.on ? t('titleOn') : t('titleOff')}
          {data?.on && data.status && <StatusBadge state={data} />}
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        {isPending ? (
          <Skeleton className='h-24 w-full' />
        ) : data?.on ? (
          <>
            <div className='grid gap-3 sm:grid-cols-3'>
              <Fact label={t('plan')}>
                {data.plan_name ?? summary.plan.name}
                {data.amount != null && data.currency && (
                  <span className='text-muted-foreground font-normal'>
                    {' '}
                    ·{' '}
                    {t('perMonth', {
                      price: formatMoney(format.number, data.amount, data.currency)
                    })}
                  </span>
                )}
              </Fact>
              <Fact label={data.cancel_at_period_end ? t('endsOn') : t('nextCharge')}>
                {data.current_period_end
                  ? format.dateTime(new Date(data.current_period_end), { dateStyle: 'long' })
                  : '—'}
              </Fact>
              <Fact label={t('card')}>
                {data.card ? (
                  <span className='inline-flex items-center gap-2'>
                    <Icons.creditCard className='size-4' aria-hidden />
                    {BRANDS[data.card.brand] ?? t('cardGeneric')} •••• {data.card.last4}
                    <span className='text-muted-foreground font-normal'>
                      {t('expires', {
                        date: `${String(data.card.exp_month).padStart(2, '0')}/${String(data.card.exp_year).slice(-2)}`
                      })}
                    </span>
                  </span>
                ) : (
                  t('cardUnknown')
                )}
              </Fact>
            </div>
            {(data.status === 'past_due' || data.status === 'unpaid') && (
              <p className='text-destructive text-sm'>{t('pastDue')}</p>
            )}
            <div className='flex flex-wrap gap-2'>
              <Button variant='outline' disabled={busy !== null} onClick={() => void run('portal')}>
                <Icons.creditCard aria-hidden /> {t('changeCard')}
              </Button>
              <Button variant='outline' disabled={busy !== null} onClick={() => void run('portal')}>
                <Icons.receipt aria-hidden /> {t('invoices')}
              </Button>
              {data.cancel_at_period_end ? (
                <Button disabled={busy !== null} onClick={() => void run('resume')}>
                  <Icons.refresh aria-hidden /> {t('resume')}
                </Button>
              ) : (
                <Button variant='ghost' disabled={busy !== null} onClick={() => setConfirm(true)}>
                  {t('cancel')}
                </Button>
              )}
            </div>
            {!data.cancel_at_period_end && paid.length > 1 && (
              <div className='flex flex-wrap items-end gap-2 border-t pt-4'>
                <label className='grid gap-1.5 text-sm' htmlFor='autopay-switch'>
                  <span className='font-medium'>{t('switchLabel')}</span>
                  <NativeSelect
                    id='autopay-switch'
                    value={planKey}
                    onChange={(e) => setPlanKey(e.target.value)}
                  >
                    {paid.map((p) => (
                      <NativeSelectOption key={p.key} value={p.key}>
                        {p.name} ·{' '}
                        {t('perMonth', {
                          price: formatMoney(format.number, p.price ?? 0, p.currency ?? 'usd')
                        })}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <Button
                  variant='secondary'
                  disabled={busy !== null || planKey === (data.plan_key ?? summary.plan.key)}
                  onClick={() => void run('switch', planKey)}
                >
                  {t('switch')}
                </Button>
                <p className='text-muted-foreground w-full text-xs'>{t('switchHint')}</p>
              </div>
            )}
          </>
        ) : (
          <>
            <p className='text-muted-foreground text-sm'>{t('intro')}</p>
            <ul className='text-muted-foreground grid gap-1.5 text-sm'>
              {(['safe', 'invoices', 'cancel'] as const).map((k) => (
                <li key={k} className='flex items-start gap-2'>
                  <Icons.check className='text-primary mt-0.5 size-4 shrink-0' aria-hidden />
                  {t(`points.${k}`)}
                </li>
              ))}
            </ul>
            <div className='flex flex-wrap items-end gap-2'>
              <label className='grid gap-1.5 text-sm' htmlFor='autopay-plan'>
                <span className='font-medium'>{t('planLabel')}</span>
                <NativeSelect
                  id='autopay-plan'
                  value={planKey}
                  onChange={(e) => setPlanKey(e.target.value)}
                >
                  {paid.map((p) => (
                    <NativeSelectOption key={p.key} value={p.key}>
                      {p.name} ·{' '}
                      {t('perMonth', {
                        price: formatMoney(format.number, p.price ?? 0, p.currency ?? 'usd')
                      })}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <Button
                disabled={busy !== null || !planKey}
                onClick={() => void run('start', planKey)}
              >
                <Icons.lock aria-hidden /> {busy === 'start' ? t('opening') : t('start')}
              </Button>
            </div>
            <p className='text-muted-foreground text-xs'>{t('stripeNote')}</p>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirm} onOpenChange={(open) => busy === null && setConfirm(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmText', {
                date: data?.current_period_end
                  ? format.dateTime(new Date(data.current_period_end), { dateStyle: 'long' })
                  : '—'
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={busy !== null}
              onClick={() => void run('cancel')}
            >
              {t('confirmCancel')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='bg-muted/40 rounded-lg border p-3'>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p className='mt-1 text-sm font-medium'>{children}</p>
    </div>
  );
}

function StatusBadge({ state }: { state: AutopayState }) {
  const t = useTranslations('billing.autopay.status');
  if (state.cancel_at_period_end) return <Badge variant='outline'>{t('ending')}</Badge>;
  if (state.status === 'past_due' || state.status === 'unpaid')
    return <Badge variant='destructive'>{t('pastDue')}</Badge>;
  if (state.status === 'incomplete') return <Badge variant='secondary'>{t('pending')}</Badge>;
  return <Badge>{t('active')}</Badge>;
}
