'use client';

import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useQueryStates } from 'nuqs';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useErrorMessage } from '@/hooks/use-error-message';
import { downloadCsv, toCsv } from '@/lib/csv';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { DailyBars, RankedList, VIZ_COLORS } from '@/features/insights/components/charts';
import { RangeTabs } from '@/features/insights/components/range-tabs';
import { StatTile } from '@/features/insights/components/stat-tile';
import { Pager, SearchBox, SortButton } from '@/features/insights/components/table-tools';
import { fillDays, percentChange } from '@/features/insights/lib/range';
import { useNow } from '@/features/insights/lib/use-now';
import {
  paymentDetailQueryOptions,
  paymentsQueryOptions,
  paymentsSummaryQueryOptions
} from '../api/queries';
import { exportPayments } from '../api/service';
import { PAYMENT_STATUSES, type Payment, type PaymentSort, type PaymentStatus } from '../api/types';
import { paymentParams, toPaymentFilters } from '../lib/filters';
import { minorToMajor, moneyFormat } from '../lib/money';

const STATUS_VARIANT: Record<PaymentStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  paid: 'default',
  pending: 'secondary',
  failed: 'destructive',
  refunded: 'outline',
  expired: 'outline'
};

function useMoney() {
  const format = useFormatter();
  return (amount: number, currency: string) =>
    format.number(minorToMajor(amount, currency), moneyFormat(currency));
}

/**
 * Payments made on the website (reported by its server with its LevelUp key).
 * KPIs and chart per currency, searchable table, detail drawer; customer
 * details are masked by the database for viewers.
 */
export function PaymentsView() {
  const scope = useSiteScope();
  const [isPending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(paymentParams, {
    startTransition,
    shallow: true,
    history: 'replace'
  });
  const filters = toPaymentFilters(params);
  const db = createClient();
  const { data: summary } = useSuspenseQuery(
    paymentsSummaryQueryOptions(db, scope.websiteId, params.range, filters.live)
  );
  const { data: page } = useSuspenseQuery(paymentsQueryOptions(db, scope.websiteId, filters));
  const [selected, setSelected] = useState<string | null>(null);
  const t = useTranslations('insights.payments');
  const money = useMoney();
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const now = useNow();

  const exportCsv = useMutation({
    mutationFn: () => exportPayments(db, scope.websiteId, filters),
    onSuccess: (rows) => {
      const csv = toCsv(
        [
          'date',
          'status',
          'amount',
          'currency',
          'offer',
          'customer_email',
          'customer_name',
          'session',
          'payment_intent'
        ],
        rows.map((p) => [
          p.occurred_at,
          p.status,
          minorToMajor(p.amount, p.currency),
          p.currency.toUpperCase(),
          p.offer_name ?? p.offer_id,
          p.customer_email,
          p.customer_name,
          p.provider_session_id,
          p.provider_payment_intent
        ])
      );
      downloadCsv(`payments-${scope.websiteId}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(t('exported', { count: rows.length }));
    },
    onError: (error) => toast.error(errorMessage(error))
  });

  if (summary.total_count === 0 && summary.test_count === 0) {
    return (
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.creditCard />
          </EmptyMedia>
          <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const main = summary.currencies[0];
  const sortBy = (sort: PaymentSort) =>
    setParams({ sort, asc: params.sort === sort ? !params.asc : false, page: 1 });
  const ariaSort = (sort: PaymentSort) =>
    params.sort === sort ? (params.asc ? 'ascending' : 'descending') : 'none';
  const chartData = main
    ? fillDays(
        summary.from.slice(0, 10),
        new Date(now).toISOString().slice(0, 10),
        summary.series.filter((s) => s.currency === main.currency),
        (row) => ({ s0: row ? minorToMajor(row.amount, main.currency) : 0 })
      )
    : [];

  return (
    <div
      className={cn('space-y-6 transition-opacity', isPending && 'opacity-60')}
      aria-busy={isPending}
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <label className='flex items-center gap-2 text-sm'>
          <Switch
            checked={params.test}
            onCheckedChange={(checked) => setParams({ test: checked, page: 1 })}
            aria-label={t('testMode')}
          />
          {t('testMode')}
          {summary.test_count > 0 && <Badge variant='secondary'>{summary.test_count}</Badge>}
        </label>
        <RangeTabs value={params.range} onChange={(range) => setParams({ range })} />
      </div>

      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <StatTile
          label={t('revenue')}
          value={main ? money(main.revenue, main.currency) : '0'}
          delta={main ? percentChange(main.revenue, main.previous_revenue) : null}
          deltaLabel={t('vsPrevious')}
          hint={
            summary.currencies.length > 1
              ? summary.currencies
                  .slice(1)
                  .map((c) => money(c.revenue, c.currency))
                  .join(' · ')
              : undefined
          }
          icon='creditCard'
        />
        <StatTile
          label={t('count')}
          value={main ? main.paid_count : 0}
          hint={t('pendingFailed', {
            pending: summary.pending_count,
            failed: summary.failed_count
          })}
          icon='receipt'
        />
        <StatTile
          label={t('average')}
          value={
            main && main.paid_count
              ? money(Math.round(main.revenue / main.paid_count), main.currency)
              : '–'
          }
          icon='chartBar'
        />
        <StatTile
          label={t('refunds')}
          value={main ? money(main.refunded, main.currency) : '0'}
          hint={t('refundCount', { count: main?.refund_count ?? 0 })}
          icon='refund'
        />
      </div>

      {main && (
        <div className='grid grid-cols-1 gap-4 xl:grid-cols-3'>
          <Card className='xl:col-span-2'>
            <CardHeader>
              <CardTitle className='text-base'>{t('chartTitle')}</CardTitle>
              <CardDescription>
                {t('chartDescription', { currency: main.currency.toUpperCase() })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DailyBars
                data={chartData}
                series={[{ key: 's0', label: t('revenue'), color: VIZ_COLORS[0] }]}
                ariaLabel={t('chartTitle')}
                valueFormatter={(v) => format.number(v, moneyFormat(main.currency, true))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>{t('offersTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <RankedList
                items={summary.offers
                  .filter((o) => o.currency === main.currency)
                  .map((o) => ({
                    key: `${o.offer}-${o.currency}`,
                    label: o.offer || t('noOffer'),
                    value: o.amount,
                    detail: t('countShort', { count: o.count })
                  }))}
                valueLabel={(v) => money(v, main.currency)}
                empty={t('noOffers')}
              />
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className='gap-3'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <CardTitle className='text-base'>{t('tableTitle')}</CardTitle>
            {scope.canAdmin && (
              <Button
                size='sm'
                variant='outline'
                disabled={exportCsv.isPending || page.total === 0}
                onClick={() => exportCsv.mutate()}
              >
                <Icons.download className='mr-2 size-4' /> {t('export')}
              </Button>
            )}
          </div>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
            <SearchBox
              value={params.q}
              onChange={(q) => setParams({ q, page: 1 })}
              label={t('search')}
              placeholder={page.pii ? t('searchPlaceholder') : t('searchPlaceholderMasked')}
            />
            <div className='flex flex-wrap gap-1.5' role='group' aria-label={t('statusFilter')}>
              {PAYMENT_STATUSES.map((s) => {
                const on = params.status.includes(s);
                return (
                  <Button
                    key={s}
                    size='sm'
                    variant={on ? 'secondary' : 'ghost'}
                    aria-pressed={on}
                    className='h-8'
                    onClick={() =>
                      setParams({
                        status: on ? params.status.filter((x) => x !== s) : [...params.status, s],
                        page: 1
                      })
                    }
                  >
                    {t(`status.${s}`)}
                  </Button>
                );
              })}
            </div>
          </div>
          {!page.pii && <p className='text-muted-foreground text-xs'>{t('maskedNotice')}</p>}
        </CardHeader>
        <CardContent className='space-y-4'>
          {page.rows.length === 0 ? (
            <p className='text-muted-foreground py-8 text-center text-sm'>{t('noMatch')}</p>
          ) : (
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead aria-sort={ariaSort('occurred_at')}>
                      <SortButton
                        label={t('date')}
                        active={params.sort === 'occurred_at'}
                        ascending={params.asc}
                        onClick={() => sortBy('occurred_at')}
                      />
                    </TableHead>
                    <TableHead aria-sort={ariaSort('customer')}>
                      {page.pii ? (
                        <SortButton
                          label={t('customer')}
                          active={params.sort === 'customer'}
                          ascending={params.asc}
                          onClick={() => sortBy('customer')}
                        />
                      ) : (
                        t('customer')
                      )}
                    </TableHead>
                    <TableHead aria-sort={ariaSort('offer_name')}>
                      <SortButton
                        label={t('offer')}
                        active={params.sort === 'offer_name'}
                        ascending={params.asc}
                        onClick={() => sortBy('offer_name')}
                      />
                    </TableHead>
                    <TableHead aria-sort={ariaSort('status')}>
                      <SortButton
                        label={t('statusLabel')}
                        active={params.sort === 'status'}
                        ascending={params.asc}
                        onClick={() => sortBy('status')}
                      />
                    </TableHead>
                    <TableHead className='text-right' aria-sort={ariaSort('amount')}>
                      <SortButton
                        label={t('amount')}
                        active={params.sort === 'amount'}
                        ascending={params.asc}
                        onClick={() => sortBy('amount')}
                      />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.rows.map((p) => (
                    <TableRow
                      key={p.id}
                      className='cursor-pointer'
                      tabIndex={0}
                      onClick={() => setSelected(p.id)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(p.id)}
                    >
                      <TableCell className='whitespace-nowrap'>
                        {format.dateTime(new Date(p.occurred_at), {
                          dateStyle: 'medium',
                          timeStyle: 'short'
                        })}
                      </TableCell>
                      <TableCell className='max-w-56'>
                        <div className='truncate font-medium'>{p.customer_name || '–'}</div>
                        <div className='text-muted-foreground truncate text-xs'>
                          {p.customer_email}
                        </div>
                      </TableCell>
                      <TableCell className='max-w-56 truncate'>
                        {p.offer_name || p.offer_id || '–'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[p.status]}>{t(`status.${p.status}`)}</Badge>
                      </TableCell>
                      <TableCell className='text-right font-medium whitespace-nowrap tabular-nums'>
                        {money(p.amount, p.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pager
            page={filters.page}
            perPage={filters.perPage}
            total={page.total}
            onPage={(p) => setParams({ page: p })}
          />
        </CardContent>
      </Card>

      <PaymentDrawer id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function PaymentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const scope = useSiteScope();
  const t = useTranslations('insights.payments');
  const money = useMoney();
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const { data, isLoading, error } = useQuery({
    ...paymentDetailQueryOptions(createClient(), scope.websiteId, id ?? ''),
    enabled: !!id
  });
  const date = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }) : '–';
  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-lg'>
        <SheetHeader>
          <SheetTitle>{t('detailTitle')}</SheetTitle>
          <SheetDescription>{data ? data.offer_name || data.offer_id || '' : ''}</SheetDescription>
        </SheetHeader>
        <div className='space-y-5 px-4 pb-6'>
          {isLoading && <Skeleton className='h-48 w-full' />}
          {error && <p className='text-destructive text-sm'>{errorMessage(error)}</p>}
          {data && <PaymentDetailBody payment={data} money={money} date={date} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PaymentDetailBody({
  payment,
  money,
  date
}: {
  payment: Payment & {
    metadata: Record<string, unknown>;
    events: {
      provider_event_id: string;
      status: PaymentStatus;
      applied: boolean;
      received_at: string;
    }[];
  };
  money: (amount: number, currency: string) => string;
  date: (value: string | null) => string;
}) {
  const t = useTranslations('insights.payments');
  const rows: [string, React.ReactNode][] = [
    [
      t('amount'),
      <span key='a' className='font-semibold tabular-nums'>
        {money(payment.amount, payment.currency)}
      </span>
    ],
    [
      t('statusLabel'),
      <Badge key='s' variant={STATUS_VARIANT[payment.status]}>
        {t(`status.${payment.status}`)}
      </Badge>
    ],
    [t('customer'), payment.customer_name || '–'],
    [t('email'), payment.customer_email || '–'],
    [t('date'), date(payment.occurred_at)],
    [t('paidAt'), date(payment.paid_at)],
    [t('refundedAt'), date(payment.refunded_at)],
    [t('mode'), payment.livemode ? t('live') : t('test')],
    [
      t('session'),
      <code key='c' className='text-xs break-all'>
        {payment.provider_session_id}
      </code>
    ],
    [
      t('intent'),
      <code key='i' className='text-xs break-all'>
        {payment.provider_payment_intent || '–'}
      </code>
    ]
  ];
  const meta = Object.entries(payment.metadata ?? {});
  return (
    <>
      <dl className='grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-2 text-sm'>
        {rows.map(([label, value]) => (
          <div key={label} className='contents'>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='min-w-0'>{value}</dd>
          </div>
        ))}
      </dl>
      {payment.masked && <p className='text-muted-foreground text-xs'>{t('maskedNotice')}</p>}
      {meta.length > 0 && (
        <section className='space-y-2'>
          <h3 className='text-sm font-medium'>{t('metadata')}</h3>
          <dl className='grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-1 text-sm'>
            {meta.map(([k, v]) => (
              <div key={k} className='contents'>
                <dt className='text-muted-foreground truncate'>{k}</dt>
                <dd className='min-w-0 break-words'>
                  {typeof v === 'string' ? v : JSON.stringify(v)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section className='space-y-2'>
        <h3 className='text-sm font-medium'>{t('history')}</h3>
        <ol className='space-y-2 text-sm'>
          {payment.events.map((e) => (
            <li key={e.provider_event_id} className='flex items-center justify-between gap-3'>
              <span className='flex items-center gap-2'>
                <Badge variant={e.applied ? STATUS_VARIANT[e.status] : 'outline'}>
                  {t(`status.${e.status}`)}
                </Badge>
                {!e.applied && (
                  <span className='text-muted-foreground text-xs'>{t('ignored')}</span>
                )}
              </span>
              <span className='text-muted-foreground text-xs'>{date(e.received_at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
