'use client';
import { useFormatter, useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';
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

/** "What you owe": charges with status, due date, discount and final amount, plus the total due. */
export function ChargesCard({ money }: { money: BillingMoney }) {
  const t = useTranslations('billing.owe');
  const format = useFormatter();
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
                      </TableRow>
                    ))}
                  </TableFooter>
                )}
              </Table>
            </div>
          </>
        )}
        <HowToPay />
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

/** Neutral note: online payment is coming; how to pay for now. No provider named. */
export function HowToPay() {
  const t = useTranslations('billing.owe');
  return (
    <div className='bg-muted/40 flex gap-3 rounded-lg border p-3 text-sm'>
      <Icons.info className='text-muted-foreground mt-0.5 size-4 shrink-0' aria-hidden />
      <div>
        <p className='font-medium'>{t('howToPayTitle')}</p>
        <p className='text-muted-foreground'>{t.rich('howToPay', { email: emailLink })}</p>
      </div>
    </div>
  );
}
