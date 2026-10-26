'use client';

import { Bar, BarChart, Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import { useFormatter } from 'next-intl';

/** Categorical slots in fixed order (src/styles/viz.css); never cycled. */
export const VIZ_COLORS = [
  'var(--viz-1)',
  'var(--viz-2)',
  'var(--viz-3)',
  'var(--viz-4)',
  'var(--viz-5)',
  'var(--viz-6)'
] as const;
export const VIZ_OTHER = 'var(--viz-other)';

export interface ChartSeries {
  /** Data key (generated, CSS-safe: s0, s1, …). */
  key: string;
  label: string;
  color: string;
}

type Row = { day: string } & Record<string, number | string>;

function useDayTick() {
  const format = useFormatter();
  return (value: string) =>
    format.dateTime(new Date(`${value}T12:00:00Z`), { month: 'short', day: 'numeric' });
}

function useDayLabel() {
  const format = useFormatter();
  return (value: unknown) =>
    typeof value === 'string'
      ? format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: 'medium' })
      : String(value ?? '');
}

/**
 * Daily bars, one message per chart. Several series are stacked (2px gaps,
 * legend under the chart); one series needs no legend (the title names it).
 */
export function DailyBars({
  data,
  series,
  ariaLabel,
  valueFormatter,
  className
}: {
  data: Row[];
  series: ChartSeries[];
  ariaLabel: string;
  valueFormatter?: (value: number) => string;
  className?: string;
}) {
  const tick = useDayTick();
  const dayLabel = useDayLabel();
  const config = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }])
  ) satisfies ChartConfig;
  const stacked = series.length > 1;
  return (
    <ChartContainer
      config={config}
      className={cn('aspect-auto h-56 w-full', className)}
      role='img'
      aria-label={ariaLabel}
    >
      <BarChart data={data} margin={{ left: 0, right: 4, top: 8 }} barCategoryGap='18%'>
        <CartesianGrid vertical={false} strokeOpacity={0.4} />
        <XAxis
          dataKey='day'
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={tick}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={valueFormatter ? 64 : 32}
          allowDecimals={false}
          tickFormatter={valueFormatter ? (v: number) => valueFormatter(v) : undefined}
        />
        <ChartTooltip
          cursor={{ fillOpacity: 0.4 }}
          content={
            <ChartTooltipContent
              labelFormatter={dayLabel}
              formatter={
                valueFormatter
                  ? (value, name) => (
                      <div className='flex w-full justify-between gap-4'>
                        <span className='text-muted-foreground'>
                          {config[String(name)]?.label ?? String(name)}
                        </span>
                        <span className='font-mono font-medium tabular-nums'>
                          {valueFormatter(Number(value))}
                        </span>
                      </div>
                    )
                  : undefined
              }
            />
          }
        />
        {stacked && <ChartLegend content={<ChartLegendContent />} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId={stacked ? 'a' : undefined}
            fill={`var(--color-${s.key})`}
            stroke='var(--card)'
            strokeWidth={stacked ? 2 : 0}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
            maxBarSize={28}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** Daily area + 2px line for a single measure over time. */
export function DailyArea({
  data,
  dataKey,
  label,
  color = VIZ_COLORS[0],
  ariaLabel,
  className
}: {
  data: Row[];
  dataKey: string;
  label: string;
  color?: string;
  ariaLabel: string;
  className?: string;
}) {
  const tick = useDayTick();
  const dayLabel = useDayLabel();
  const config = { [dataKey]: { label, color } } satisfies ChartConfig;
  const gradient = `fill-${dataKey}`;
  return (
    <ChartContainer
      config={config}
      className={cn('aspect-auto h-56 w-full', className)}
      role='img'
      aria-label={ariaLabel}
    >
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id={gradient} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='5%' stopColor={`var(--color-${dataKey})`} stopOpacity={0.28} />
            <stop offset='95%' stopColor={`var(--color-${dataKey})`} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeOpacity={0.4} />
        <XAxis
          dataKey='day'
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={tick}
        />
        <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={dayLabel} />} />
        <Area
          dataKey={dataKey}
          type='monotone'
          stroke={`var(--color-${dataKey})`}
          strokeWidth={2}
          fill={`url(#${gradient})`}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
        />
      </AreaChart>
    </ChartContainer>
  );
}

/**
 * Ranked list with proportional bars (top pages, referrers, languages):
 * labels and values are text, the bar only supports the comparison.
 */
export function RankedList({
  items,
  valueLabel,
  empty
}: {
  items: { key: string; label: React.ReactNode; value: number; detail?: string }[];
  valueLabel: (value: number) => string;
  empty: React.ReactNode;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length)
    return <p className='text-muted-foreground py-6 text-center text-sm'>{empty}</p>;
  return (
    <ul className='space-y-2'>
      {items.map((item) => (
        <li key={item.key} className='space-y-1'>
          <div className='flex items-baseline justify-between gap-3 text-sm'>
            <span
              className='min-w-0 truncate'
              title={typeof item.label === 'string' ? item.label : undefined}
            >
              {item.label}
            </span>
            <span className='text-muted-foreground shrink-0 tabular-nums'>
              {valueLabel(item.value)}
              {item.detail && <span className='ml-2 text-xs'>{item.detail}</span>}
            </span>
          </div>
          <div className='bg-muted h-1.5 overflow-hidden rounded-full'>
            <div
              className='h-full rounded-full'
              style={{ width: `${(item.value / max) * 100}%`, background: VIZ_COLORS[0] }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
