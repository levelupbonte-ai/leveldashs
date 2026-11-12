'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useErrorMessage } from '@/hooks/use-error-message';
import { cn } from '@/lib/utils';
import { billingKeys } from '../api/queries';
import { chargeDocumentUrl, startOnlinePayment } from '../api/service';
import type { OnlinePaymentMethod } from '../api/types';
import type { BillingMoney, ChargeRow, ChargeStatus } from '../api/types';
import { formatMoney } from '../lib/format';

export const CONTACT_EMAIL = 'contact@levelup-ecosystem.com';

export const CHARGE_VARIANT: Record<
  ChargeStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  due: 'default',
  overdue: 'destructive',
  paid: 'secondary',
  void: 'outline'
};

/** Local calendar date of a `YYYY-MM-DD` (noon avoids a time-zone day shift). */
export const dayDate = (day: string) => new Date(`${day}T12:00:00`);

interface ChargesCardProps {
  money: BillingMoney;
  /** Online payment switched on by the server (LEVELUP_ONLINE_PAYMENTS + keys). */
  onlinePayments?: OnlinePaymentMethod[];
}

/**
 * "What you owe": charges with their invoice number, status, due date, discount
 * and final amount, the total due, and per charge the invoice / receipt PDFs
 * (once LevelUp's business details are complete) and "Pay online" when it is on.
 */
export function ChargesCard({ money, onlinePayments = [] }: ChargesCardProps) {
  const t = useTranslations('billing.owe');
  const format = useFormatter();
  usePaymentReturn();
  const fmt = (amount: number, currency: string) => formatMoney(format.number, amount, currency);
  const day = (d: string) => format.dateTime(dayDate(d), { dateStyle: 'medium' });

  return (
    <Card>
      <CardHeader className='gap-4 sm:flex sm:flex-row sm:items-start sm:justify-between'>
        <div className='space-y-1.5'>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <div className='sm:text-right'>
          <p className='text-muted-foreground text-xs'>{t('totalDue')}</p>
          {money.total_due.length === 0 ? (
            <p className='text-2xl font-semibold tabular-nums'>{fmt(0, money.currency)}</p>
          ) : (
            money.total_due.map((d) => (
              <p key={d.currency} className='text-2xl font-semibold tabular-nums'>
                {fmt(d.amount, d.currency)}
              </p>
            ))
          )}
          {money.overdue_count > 0 && (
            <p className='text-destructive text-xs font-medium'>
              {t('overdue', { count: money.overdue_count })}
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {money.charges.length === 0 ? (
          <Empty className='border'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Icons.receipt />
              </EmptyMedia>
              <EmptyTitle>{t('nothingDue')}</EmptyTitle>
              <EmptyDescription>{t('nothingDueHint')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {/* Phones: one card per charge. */}
            <ul className='divide-y rounded-lg border sm:hidden'>
              {money.charges.map((c) => (
                <li key={c.id} className={cn('space-y-1 p-3', c.status === 'void' && 'opacity-60')}>
                  <div className='flex items-start justify-between gap-3'>
                    <ChargeLabel charge={c} />
                    <span className='shrink-0 font-semibold tabular-nums'>
                      {fmt(c.amount, c.currency)}
                    </span>
                  </div>
                  <div className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
                    <Badge variant={CHARGE_VARIANT[c.status]}>
                      {t(`chargeStatus.${c.status}`)}
                    </Badge>
                    <span>
                      {c.status === 'paid' && c.paid_at
                        ? t('paidOn', {
                            date: format.dateTime(new Date(c.paid_at), {
                              dateStyle: 'medium'
                            })
                          })
                        : c.due_date
                          ? `${t('dueDate')} ${day(c.due_date)}`
                          : null}
                    </span>
                    {c.discount_amount > 0 && (
                      <span>
                        {c.discount_label} −{fmt(c.discount_amount, c.currency)} ·{' '}
                        <span className='line-through'>{fmt(c.base_amount, c.currency)}</span>
                      </span>
                    )}
                  </div>
                  <ChargeActions
                    charge={c}
                    documents={money.documents_ready}
                    onlinePayments={onlinePayments}
                    className='pt-2'
                  />
                </li>
              ))}
            </ul>
            <div className='hidden rounded-lg border sm:block'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('charge')}</TableHead>
                    <TableHead>{t('dueDate')}</TableHead>
                    <TableHead>{t('status')}</TableHead>
                    <TableHead className='text-right'>{t('amount')}</TableHead>
                    <TableHead className='text-right'>{t('discount')}</TableHead>
                    <TableHead className='text-right'>{t('final')}</TableHead>
                    <TableHead>
                      <span className='sr-only'>{t('invoice')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {money.charges.map((c) => (
                    <TableRow key={c.id} className={cn(c.status === 'void' && 'opacity-60')}>
                      <TableCell className='max-w-xs whitespace-normal'>
                        <ChargeLabel charge={c} />
                      </TableCell>
                      <TableCell className='tabular-nums'>
                        {c.status === 'paid' && c.paid_at
                          ? t('paidOn', {
                              date: format.dateTime(new Date(c.paid_at), {
                                dateStyle: 'medium'
                              })
                            })
                          : c.due_date
                            ? day(c.due_date)
                            : t('noDueDate')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={CHARGE_VARIANT[c.status]}>
                          {t(`chargeStatus.${c.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {fmt(c.base_amount, c.currency)}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-right tabular-nums'>
                        {c.discount_amount > 0 ? (
                          <span className='flex flex-col items-end'>
                            <span>−{fmt(c.discount_amount, c.currency)}</span>
                            <span className='text-xs'>{c.discount_label}</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-semibold tabular-nums',
                          c.status === 'void' && 'line-through'
                        )}
                      >
                        {fmt(c.amount, c.currency)}
                      </TableCell>
                      <TableCell className='w-0'>
                        <ChargeActions
                          charge={c}
                          documents={money.documents_ready}
                          onlinePayments={onlinePayments}
                          className='flex-nowrap justify-end'
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {money.total_due.length > 0 && (
                  <TableFooter>
                    {money.total_due.map((d) => (
                      <TableRow key={d.currency}>
                        <TableCell colSpan={5} className='text-right'>
                          {t('totalDue')}
                        </TableCell>
                        <TableCell className='text-right font-semibold tabular-nums'>
                          {fmt(d.amount, d.currency)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    ))}
                  </TableFooter>
                )}
              </Table>
            </div>
          </>
        )}
        <HowToPay online={onlinePayments.length > 0} />
      </CardContent>
    </Card>
  );
}

function ChargeLabel({ charge }: { charge: ChargeRow }) {
  const t = useTranslations('billing.owe');
  return (
    <div className='min-w-0'>
      <p className='font-medium break-words'>{charge.label}</p>
      <p className='text-muted-foreground text-xs'>
        <span className='tabular-nums'>{t('number', { number: charge.invoice_number })}</span>
        {' · '}
        {t(`kind.${charge.kind}`)}
        {charge.description ? ` · ${charge.description}` : ''}
      </p>
    </div>
  );
}

const emailLink = () => (
  <a className='text-primary underline' href={`mailto:${CONTACT_EMAIL}`}>
    {CONTACT_EMAIL}
  </a>
);

/** How to pay: online by card when it is on, otherwise the details LevelUp sends. No provider named. */
export function HowToPay({ online = false }: { online?: boolean }) {
  const t = useTranslations('billing.owe');
  return (
    <div className='bg-muted/40 flex gap-3 rounded-lg border p-3 text-sm'>
      <Icons.info className='text-muted-foreground mt-0.5 size-4 shrink-0' aria-hidden />
      <div>
        <p className='font-medium'>{t('howToPayTitle')}</p>
        <p className='text-muted-foreground'>
          {t.rich(online ? 'howToPayOnline' : 'howToPay', { email: emailLink })}
        </p>
      </div>
    </div>
  );
}

/** Invoice and receipt downloads, and "Pay online" for a charge still due. */
export function ChargeActions({
  charge,
  documents,
  onlinePayments = [],
  className
}: {
  charge: ChargeRow;
  /** LevelUp's business details are complete (documents can be downloaded). */
  documents: boolean;
  onlinePayments?: OnlinePaymentMethod[];
  className?: string;
}) {
  const t = useTranslations('billing.owe');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const pay = useMutation({
    mutationFn: (method: OnlinePaymentMethod) => startOnlinePayment(charge.id, method),
    onSuccess: (url) => window.location.assign(url),
    onError: (e) => {
      const alternative = (e as { cause?: { alternative?: OnlinePaymentMethod | null } }).cause
        ?.alternative;
      if (alternative && onlinePayments.includes(alternative)) {
        toast.error(t('payTryOther'), {
          action: {
            label: alternative === 'paypal' ? t('payPaypal') : t('payCard'),
            onClick: () => pay.mutate(alternative)
          }
        });
        return;
      }
      toast.error(errorMessage(e, 'paymentUnavailable'));
    }
  });
  const payable =
    onlinePayments.length > 0 && (charge.status === 'due' || charge.status === 'overdue');
  if (!documents && !payable) return null;
  const link = buttonVariants({ size: 'sm', variant: 'outline', className: 'h-8 gap-1.5' });

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {documents && (
        <a
          href={chargeDocumentUrl(charge.id, 'invoice')}
          download
          className={link}
          aria-label={t('invoiceLabel', { number: charge.invoice_number })}
        >
          <Icons.fileInvoice className='size-4' aria-hidden />
          {t('invoice')}
        </a>
      )}
      {documents && charge.status === 'paid' && (
        <a
          href={chargeDocumentUrl(charge.id, 'receipt')}
          download
          className={link}
          aria-label={t('receiptLabel', { number: charge.invoice_number })}
        >
          <Icons.receipt className='size-4' aria-hidden />
          {t('receipt')}
        </a>
      )}
      {payable &&
        onlinePayments.map((method) => (
          <Button
            key={method}
            size='sm'
            variant={method === 'paypal' && onlinePayments.length > 1 ? 'outline' : 'default'}
            className='h-8 gap-1.5'
            disabled={pay.isPending}
            onClick={() => pay.mutate(method)}
            aria-label={t(method === 'paypal' ? 'payPaypalLabel' : 'payOnlineLabel', {
              amount: formatMoney(format.number, charge.amount, charge.currency)
            })}
          >
            {pay.isPending && pay.variables === method ? (
              <Icons.spinner className='size-4 animate-spin' aria-hidden />
            ) : method === 'paypal' ? (
              <Icons.paypal className='size-4' aria-hidden />
            ) : (
              <Icons.creditCard className='size-4' aria-hidden />
            )}
            {method === 'paypal'
              ? t('payPaypal')
              : onlinePayments.length > 1
                ? t('payCard')
                : t('payOnline')}
          </Button>
        ))}
    </div>
  );
}

/** Back from the payment page (?payment=success|cancelled): a toast, then a fresh summary. */
function usePaymentReturn() {
  const t = useTranslations('billing.owe');
  const queryClient = useQueryClient();
  const [payment, setPayment] = useQueryState(
    'payment',
    parseAsStringLiteral(['success', 'pending', 'failed', 'cancelled'] as const)
  );
  useEffect(() => {
    if (!payment) return;
    if (payment === 'success') {
      toast.success(t('paymentSuccess'));
      // The webhook usually lands within seconds (clearing the param re-renders,
      // so the timer is not tied to this effect).
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: billingKeys.all }), 4000);
      void setPayment(null);
      return;
    }
    if (payment === 'pending') {
      toast.info(t('paymentPending'));
      void setPayment(null);
      return;
    }
    if (payment === 'failed') {
      toast.error(t('paymentFailed'));
      void setPayment(null);
      return;
    }
    toast.info(t('paymentCancelled'));
    void setPayment(null);
  }, [payment, setPayment, t, queryClient]);
}
