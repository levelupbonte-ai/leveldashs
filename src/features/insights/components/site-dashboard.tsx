'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { WeeklySummaryCard } from '@/features/assistant/components/weekly-summary';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { minorToMajor, moneyFormat } from '@/features/payments/lib/money';
import { capabilitiesQueryOptions, overviewStatsQueryOptions } from '../api/queries';
import type { OverviewStats, SiteCapabilities } from '../api/types';
import { fillDays, percentChange } from '../lib/range';
import { DailyArea, DailyBars, VIZ_COLORS, VIZ_OTHER, type ChartSeries } from './charts';
import { RangeTabs, useRange } from './range-tabs';
import { StatTile, type StatTileProps } from './stat-tile';
import { useFormTypeLabel } from './use-labels';
import { useNow } from '../lib/use-now';

const TAG_FRESH_MS = 7 * 24 * 3600 * 1000;
const MAX_FORM_SERIES = 5;

/**
 * Overview that builds itself from what the website has: a widget appears
 * when its feature is enabled or when matching data exists. Every number is
 * read from the database (RLS applies), nothing is estimated.
 */
export function SiteDashboard() {
  const scope = useSiteScope();
  const { range, setRange, isPending } = useRange();
  const db = createClient();
  const { data: stats } = useSuspenseQuery(overviewStatsQueryOptions(db, scope.websiteId, range));
  const { data: caps } = useSuspenseQuery(capabilitiesQueryOptions(db, scope.websiteId));
  const t = useTranslations('insights.overview');

  const features = new Set(scope.website.features);
  const counts = caps?.counts;
  const has = (feature: string | string[], dataKey?: keyof NonNullable<typeof counts>) =>
    (Array.isArray(feature) ? feature : [feature]).some((f) => features.has(f)) ||
    (!!dataKey && (counts?.[dataKey] ?? 0) > 0);

  return (
    <div
      className={cn('space-y-6 transition-opacity', isPending && 'opacity-60')}
      aria-busy={isPending}
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-muted-foreground text-sm'>{t('rangeHint', { count: stats.days })}</p>
        <RangeTabs value={range} onChange={setRange} />
      </div>

      <AttentionRow stats={stats} has={has} />
      <KpiRow stats={stats} caps={caps} has={has} />

      <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
        <TrafficChart stats={stats} caps={caps} />
        {has('payments', 'payments') && <RevenueChart stats={stats} />}
        <SubmissionsChart stats={stats} />
        {has('bookings', 'appointments') && <BookingsChart stats={stats} />}
        {stats.studio && stats.studio.projects_total > 0 && <StudioChart stats={stats} />}
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <SiteHealthCard caps={caps} />
        <WeeklySummaryCard />
      </div>
    </div>
  );
}

type Has = (feature: string | string[], dataKey?: keyof SiteCapabilities['counts']) => boolean;

function TileGrid({ tiles }: { tiles: (StatTileProps | false | null | undefined)[] }) {
  const shown = tiles.filter(Boolean) as StatTileProps[];
  if (!shown.length) return null;
  return (
    <div className='grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5'>
      {shown.map((tile) => (
        <StatTile key={tile.label} {...tile} />
      ))}
    </div>
  );
}

function AttentionRow({ stats, has }: { stats: OverviewStats; has: Has }) {
  const t = useTranslations('insights.overview');
  const pr = stats.project_requests;
  return (
    <section aria-labelledby='attention-title' className='space-y-2'>
      <h2 id='attention-title' className='text-sm font-medium'>
        {t('attention')}
      </h2>
      <TileGrid
        tiles={[
          {
            label: t('newRequests'),
            value: stats.submissions.new,
            hint: t('openRequests', { count: stats.submissions.open }),
            icon: 'inbox',
            href: '/dashboard/site/requests'
          },
          !!pr && {
            label: t('newProjectRequests'),
            value: pr.new,
            hint: t('qualifiedInRange', { count: pr.qualified }),
            icon: 'briefcase',
            href: '/dashboard/site/project-requests'
          },
          has('bookings', 'appointments') && {
            label: t('toConfirm'),
            value: stats.bookings.pending,
            hint: t('today', { count: stats.bookings.today }),
            icon: 'calendar',
            href: '/dashboard/site/appointments'
          },
          has('waitlist', 'waitlist') && {
            label: t('waitingNow'),
            value: stats.waitlist.waiting,
            hint: t('servedToday', { count: stats.waitlist.served_today }),
            icon: 'hourglass',
            href: '/dashboard/site/waitlist'
          },
          (has('quotes') || stats.quotes.open > 0) && {
            label: t('openQuotes'),
            value: stats.quotes.open,
            hint: t('inRange', { count: stats.quotes.in_range }),
            icon: 'listCheck',
            href: '/dashboard/site/requests?type=quote'
          }
        ]}
      />
    </section>
  );
}

function KpiRow({
  stats,
  caps,
  has
}: {
  stats: OverviewStats;
  caps: SiteCapabilities | null;
  has: Has;
}) {
  const t = useTranslations('insights.overview');
  const format = useFormatter();
  const main = stats.payments.currencies[0];
  const tracked = (caps?.counts.traffic_days ?? 0) > 0;
  const bookingsDelta = percentChange(stats.bookings.in_range, stats.bookings.previous);
  return (
    <section aria-labelledby='kpi-title' className='space-y-2'>
      <h2 id='kpi-title' className='text-sm font-medium'>
        {t('period', { count: stats.days })}
      </h2>
      <TileGrid
        tiles={[
          tracked && {
            label: t('visitors'),
            value: format.number(stats.traffic.visitors),
            hint: t('views', { count: stats.traffic.views }),
            delta: percentChange(stats.traffic.visitors, stats.traffic.previous_visitors),
            deltaLabel: t('vsPrevious'),
            icon: 'eye',
            href: '/dashboard/site/analytics'
          },
          has('payments', 'payments') && {
            label: t('revenue'),
            value: main
              ? format.number(minorToMajor(main.revenue, main.currency), moneyFormat(main.currency))
              : '0',
            hint: main
              ? t('payments', { count: main.paid_count }) +
                (stats.payments.currencies.length > 1
                  ? ` · ${t('otherCurrencies', { count: stats.payments.currencies.length - 1 })}`
                  : '')
              : t('noPayments'),
            delta: main ? percentChange(main.revenue, main.previous_revenue) : null,
            deltaLabel: t('vsPrevious'),
            icon: 'creditCard',
            href: '/dashboard/site/payments'
          },
          has('bookings', 'appointments') && {
            label: t('bookings'),
            value: stats.bookings.in_range,
            hint: t('noShows', { count: stats.bookings.no_shows }),
            delta: bookingsDelta,
            deltaLabel: t('vsPrevious'),
            icon: 'calendar',
            href: '/dashboard/site/appointments'
          },
          (has('newsletter') || stats.newsletter.total > 0) && {
            label: t('subscribers'),
            value: format.number(stats.newsletter.total),
            hint: t('newInRange', { count: stats.newsletter.in_range }),
            icon: 'mail',
            href: '/dashboard/site/requests?type=newsletter&view=all'
          },
          (has('reviews', 'reviews') || stats.reviews.count > 0) && {
            label: t('rating'),
            value:
              stats.reviews.average === null
                ? '–'
                : format.number(stats.reviews.average, { maximumFractionDigits: 1 }),
            hint: t('reviews', { count: stats.reviews.count }),
            icon: 'star',
            href: '/dashboard/site/reviews'
          },
          !!stats.project_requests && {
            label: t('projectRequests'),
            value: stats.project_requests.in_range,
            hint:
              stats.project_requests.average_score === null
                ? undefined
                : t('averageScore', { score: stats.project_requests.average_score }),
            icon: 'briefcase',
            href: '/dashboard/site/project-requests'
          },
          !!stats.studio && {
            label: t('studioProjects'),
            value: stats.studio.projects_in_range,
            hint: t('creators', { count: stats.studio.creators_in_range }),
            icon: 'template'
          }
        ]}
      />
    </section>
  );
}

function ChartCard({
  title,
  description,
  action,
  children
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-2'>
        <div className='space-y-1'>
          <CardTitle className='text-base'>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function TrafficChart({ stats, caps }: { stats: OverviewStats; caps: SiteCapabilities | null }) {
  const t = useTranslations('insights.overview');
  const tracked = (caps?.counts.traffic_days ?? 0) > 0;
  if (!tracked) {
    return (
      <ChartCard title={t('trafficTitle')}>
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>{t('noTrafficTitle')}</EmptyTitle>
            <EmptyDescription>{t('noTrafficDescription')}</EmptyDescription>
          </EmptyHeader>
          <Link
            href='/dashboard/site/developers'
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            <Icons.code className='mr-2 size-4' /> {t('installTag')}
          </Link>
        </Empty>
      </ChartCard>
    );
  }
  const data = fillDays(stats.from, stats.to, stats.traffic.series, (row) => ({
    visitors: row?.visitors ?? 0
  }));
  return (
    <ChartCard
      title={t('trafficTitle')}
      description={t('trafficDescription')}
      action={<MoreLink href='/dashboard/site/analytics' />}
    >
      <DailyArea
        data={data}
        dataKey='visitors'
        label={t('visitors')}
        ariaLabel={t('trafficTitle')}
      />
    </ChartCard>
  );
}

function RevenueChart({ stats }: { stats: OverviewStats }) {
  const t = useTranslations('insights.overview');
  const format = useFormatter();
  const main = stats.payments.currencies[0];
  if (!main) {
    return (
      <ChartCard title={t('revenueTitle')}>
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>{t('noPaymentsTitle')}</EmptyTitle>
            <EmptyDescription>{t('noPaymentsDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ChartCard>
    );
  }
  const currency = main.currency;
  const rows = stats.payments.series.filter((s) => s.currency === currency);
  const data = fillDays(stats.from, stats.to, rows, (row) => ({
    s0: row ? minorToMajor(row.amount, currency) : 0
  }));
  return (
    <ChartCard
      title={t('revenueTitle')}
      description={t('revenueDescription', { currency: currency.toUpperCase() })}
      action={<MoreLink href='/dashboard/site/payments' />}
    >
      <DailyBars
        data={data}
        series={[{ key: 's0', label: t('revenue'), color: VIZ_COLORS[0] }]}
        ariaLabel={t('revenueTitle')}
        valueFormatter={(v) => format.number(v, moneyFormat(currency, true))}
      />
    </ChartCard>
  );
}

function SubmissionsChart({ stats }: { stats: OverviewStats }) {
  const t = useTranslations('insights.overview');
  const typeLabel = useFormTypeLabel();
  const types = stats.submissions.by_type.filter((b) => b.count > 0);
  if (!types.length) {
    return (
      <ChartCard title={t('submissionsTitle')}>
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>{t('noSubmissionsTitle')}</EmptyTitle>
            <EmptyDescription>{t('noSubmissionsDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ChartCard>
    );
  }
  // Up to 5 types keep their own colour (fixed order by volume); the rest is "Other".
  const kept = types.slice(0, MAX_FORM_SERIES).map((b) => b.form_type);
  const series: ChartSeries[] = kept.map((type, i) => ({
    key: `s${i}`,
    label: typeLabel(type),
    color: VIZ_COLORS[i]
  }));
  if (types.length > MAX_FORM_SERIES) {
    series.push({ key: 'other', label: t('other'), color: VIZ_OTHER });
  }
  const byDay = new Map<string, Record<string, number>>();
  for (const row of stats.submissions.series) {
    const idx = kept.indexOf(row.form_type);
    const key = idx >= 0 ? `s${idx}` : 'other';
    const day = byDay.get(row.day) ?? {};
    day[key] = (day[key] ?? 0) + row.count;
    byDay.set(row.day, day);
  }
  const data = fillDays(
    stats.from,
    stats.to,
    [...byDay.keys()].map((day) => ({ day })),
    (_, day) => ({
      ...Object.fromEntries(series.map((s) => [s.key, 0])),
      ...byDay.get(day)
    })
  );
  return (
    <ChartCard
      title={t('submissionsTitle')}
      description={t('submissionsDescription')}
      action={<MoreLink href='/dashboard/site/requests' />}
    >
      <DailyBars data={data} series={series} ariaLabel={t('submissionsTitle')} />
      <ul className='mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3'>
        {types.map((b) => (
          <li key={b.form_type} className='flex justify-between gap-2'>
            <Link
              href={`/dashboard/site/requests?type=${encodeURIComponent(b.form_type)}&view=all`}
              className='text-muted-foreground hover:text-foreground truncate underline-offset-4 hover:underline'
            >
              {typeLabel(b.form_type)}
            </Link>
            <span className='tabular-nums'>{b.count}</span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

function BookingsChart({ stats }: { stats: OverviewStats }) {
  const t = useTranslations('insights.overview');
  const to = new Date(`${stats.to}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 14);
  const data = fillDays(
    stats.from,
    to.toISOString().slice(0, 10),
    stats.bookings.series,
    (row) => ({
      s0: row?.count ?? 0
    })
  );
  return (
    <ChartCard
      title={t('bookingsTitle')}
      description={t('bookingsDescription', {
        completed: stats.bookings.completed,
        noShows: stats.bookings.no_shows
      })}
      action={<MoreLink href='/dashboard/site/appointments' />}
    >
      <DailyBars
        data={data}
        series={[{ key: 's0', label: t('bookings'), color: VIZ_COLORS[0] }]}
        ariaLabel={t('bookingsTitle')}
      />
    </ChartCard>
  );
}

function StudioChart({ stats }: { stats: OverviewStats }) {
  const t = useTranslations('insights.overview');
  const studio = stats.studio!;
  const data = fillDays(stats.from, stats.to, studio.series, (row) => ({ s0: row?.count ?? 0 }));
  return (
    <ChartCard
      title={t('studioTitle')}
      description={t('studioDescription', {
        generations: studio.generations_in_range,
        shared: studio.shared,
        claimed: studio.handoffs_claimed
      })}
    >
      <DailyBars
        data={data}
        series={[{ key: 's0', label: t('studioProjects'), color: VIZ_COLORS[0] }]}
        ariaLabel={t('studioTitle')}
      />
    </ChartCard>
  );
}

function SiteHealthCard({ caps }: { caps: SiteCapabilities | null }) {
  const now = useNow();
  const t = useTranslations('insights.overview');
  const format = useFormatter();
  const seen = caps?.tag.last_seen_at ? new Date(caps.tag.last_seen_at) : null;
  const active = !!seen && now - seen.getTime() < TAG_FRESH_MS;
  const updated = caps?.last_content_update ? new Date(caps.last_content_update) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('healthTitle')}</CardTitle>
        <CardDescription>{t('healthDescription')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        <div className='flex items-start justify-between gap-3'>
          <div>
            <p className='font-medium'>{t('tag')}</p>
            <p className='text-muted-foreground text-xs'>
              {seen
                ? t('tagSeen', {
                    date: format.relativeTime(seen, now),
                    version: caps?.tag.version ?? '–'
                  })
                : t('tagNever')}
            </p>
          </div>
          <Badge variant={active ? 'default' : 'secondary'}>
            {active ? t('tagActive') : t('tagInactive')}
          </Badge>
        </div>
        <div className='flex items-start justify-between gap-3'>
          <div>
            <p className='font-medium'>{t('freshness')}</p>
            <p className='text-muted-foreground text-xs'>
              {updated
                ? t('updated', { date: format.relativeTime(updated, now) })
                : t('neverUpdated')}
            </p>
          </div>
          <Link
            href='/dashboard/site/capabilities'
            className={buttonVariants({ size: 'sm', variant: 'ghost' })}
          >
            {t('seeEverything')}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function MoreLink({ href }: { href: string }) {
  const t = useTranslations('insights.overview');
  return (
    <Link href={href} className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
      {t('details')} <Icons.chevronRight className='ml-1 size-4' />
    </Link>
  );
}
