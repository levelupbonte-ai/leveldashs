'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { WorldMap, useCountryName } from '@/components/world-map';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { analyticsQueryOptions, countriesQueryOptions } from '../api/queries';
import { fillDays, percentChange } from '../lib/range';
import { DailyArea, RankedList } from './charts';
import { RangeTabs, useRange } from './range-tabs';
import { StatTile } from './stat-tile';

/** Visitor analytics from the LevelUp tag (daily counters, nothing personal). */
export function AnalyticsView() {
  const scope = useSiteScope();
  const { range, setRange, isPending } = useRange();
  const { data } = useSuspenseQuery(analyticsQueryOptions(createClient(), scope.websiteId, range));
  const { data: countries } = useSuspenseQuery(
    countriesQueryOptions(createClient(), scope.websiteId, range)
  );
  const countryName = useCountryName();
  const t = useTranslations('insights.analytics');
  const format = useFormatter();
  const languages = useLanguageName();

  if (!data.has_data) {
    return (
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.chartLine />
          </EmptyMedia>
          <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href='/dashboard/site/developers' className={buttonVariants({ size: 'sm' })}>
            <Icons.code className='mr-2 size-4' /> {t('installTag')}
          </Link>
        </EmptyContent>
      </Empty>
    );
  }

  const series = fillDays(data.from, data.to, data.series, (row) => ({
    visitors: row?.visitors ?? 0,
    views: row?.views ?? 0
  }));
  const totalLang = data.languages.reduce((sum, l) => sum + l.views, 0) || 1;
  const totalViews = data.totals.views || 1;

  return (
    <div
      className={cn('space-y-6 transition-opacity', isPending && 'opacity-60')}
      aria-busy={isPending}
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-muted-foreground text-sm'>{t('privacy')}</p>
        <RangeTabs value={range} onChange={setRange} />
      </div>

      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <StatTile
          label={t('visitors')}
          value={format.number(data.totals.visitors)}
          delta={percentChange(data.totals.visitors, data.totals.previous_visitors)}
          deltaLabel={t('vsPrevious')}
          icon='teams'
        />
        <StatTile
          label={t('views')}
          value={format.number(data.totals.views)}
          delta={percentChange(data.totals.views, data.totals.previous_views)}
          deltaLabel={t('vsPrevious')}
          icon='eye'
        />
        <StatTile
          label={t('viewsPerVisitor')}
          value={
            data.totals.visitors
              ? format.number(data.totals.views / data.totals.visitors, {
                  maximumFractionDigits: 1
                })
              : '–'
          }
          icon='listDetails'
        />
        <StatTile
          label={t('direct')}
          value={`${Math.round((data.direct_views / totalViews) * 100)}%`}
          hint={t('directHint')}
          icon='login'
        />
      </div>

      <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>{t('visitorsTitle')}</CardTitle>
            <CardDescription>{t('visitorsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <DailyArea
              data={series}
              dataKey='visitors'
              label={t('visitors')}
              ariaLabel={t('visitorsTitle')}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>{t('viewsTitle')}</CardTitle>
            <CardDescription>{t('viewsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <DailyArea
              data={series}
              dataKey='views'
              label={t('views')}
              ariaLabel={t('viewsTitle')}
            />
          </CardContent>
        </Card>
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>{t('pagesTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedList
              items={data.pages.map((p) => ({
                key: p.path,
                label: <span className='font-mono text-xs'>{p.path}</span>,
                value: p.views,
                detail: t('visitorsShort', { count: p.visitors })
              }))}
              valueLabel={(v) => t('viewsCount', { count: v })}
              empty={t('none')}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>{t('referrersTitle')}</CardTitle>
            <CardDescription>{t('referrersDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <RankedList
              items={data.referrers.map((r) => ({ key: r.host, label: r.host, value: r.views }))}
              valueLabel={(v) => t('viewsCount', { count: v })}
              empty={t('noReferrers')}
            />
          </CardContent>
        </Card>
        <Card className='lg:col-span-2'>
          <CardHeader>
            <CardTitle className='text-base'>{t('countriesTitle')}</CardTitle>
            <CardDescription>{t('countriesDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {countries.length === 0 ? (
              <p className='text-muted-foreground text-sm'>{t('countriesEmpty')}</p>
            ) : (
              <div className='grid gap-6 md:grid-cols-[2fr_1fr] md:items-center'>
                <WorldMap
                  items={countries.map((c) => ({
                    country: c.country,
                    value: c.visitors || c.views
                  }))}
                  label={t('countriesTitle')}
                  valueLabel={(v) => t('visitorsCount', { count: v })}
                />
                <RankedList
                  items={countries.slice(0, 8).map((c) => ({
                    key: c.country,
                    label: countryName(c.country),
                    value: c.visitors || c.views
                  }))}
                  valueLabel={(v) => t('visitorsCount', { count: v })}
                  empty={t('none')}
                />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>{t('languagesTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedList
              items={data.languages.map((l) => ({
                key: l.lang || 'unknown',
                label: l.lang ? languages(l.lang) : t('unknownLanguage'),
                value: l.views,
                detail: `${Math.round((l.views / totalLang) * 100)}%`
              }))}
              valueLabel={(v) => t('viewsCount', { count: v })}
              empty={t('none')}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** "fr" -> "French" in the interface language. */
function useLanguageName() {
  const locale = useLocale();
  return (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
    } catch {
      return code;
    }
  };
}
