'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { aiInsightsQueryOptions } from '../api/queries';
import type { AiModelRank, AiRoute, AiTier } from '../api/types';

const APPS = ['dashboard', 'studio', 'showcase', 'site'];
const TASKS = [
  'agents',
  'writing',
  'reports',
  'site',
  'studio_chat',
  'studio_build',
  'studio_review',
  'vision'
];

function useLabels() {
  const t = useTranslations('admin.ai');
  return {
    app: (app: string) => (APPS.includes(app) ? t(`apps.${app}` as 'apps.dashboard') : app),
    task: (task: string) => (TASKS.includes(task) ? t(`tasks.${task}` as 'tasks.agents') : task)
  };
}

function TierBadge({ tier }: { tier: AiTier | null }) {
  const t = useTranslations('admin.ai');
  if (!tier) return <Badge variant='outline'>{t('offCatalog')}</Badge>;
  return tier === 'paid' ? (
    <Badge className='border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'>
      {t('paid')}
    </Badge>
  ) : (
    <Badge variant='secondary'>{t('free')}</Badge>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const format = useFormatter();
  return (
    <div className='rounded-lg border p-3'>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p className='text-2xl font-semibold tabular-nums'>{format.number(value)}</p>
    </div>
  );
}

function Ranking({ rows }: { rows: AiModelRank[] }) {
  const t = useTranslations('admin.ai');
  const format = useFormatter();
  const nf = { format: (n: number) => format.number(n) };
  const max = Math.max(1, ...rows.map((r) => r.calls_30d));
  return (
    <ol className='space-y-2.5'>
      {rows.map((r) => (
        <li key={r.model_id} className='space-y-1'>
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <span className='font-medium'>{r.label}</span>
            <TierBadge tier={r.tier} />
            <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
              {t('calls', { count: r.calls_30d })}
              {r.share_30d != null &&
                ` · ${format.number(r.share_30d / 100, { style: 'percent', maximumFractionDigits: 1 })}`}
            </span>
          </div>
          <div className='bg-muted h-2 overflow-hidden rounded-full'>
            <div
              className={cn(
                'h-full rounded-full',
                r.tier === 'paid' ? 'bg-amber-500' : 'bg-violet-500'
              )}
              style={{ width: `${(r.calls_30d / max) * 100}%` }}
            />
          </div>
          <p className='text-muted-foreground text-[11px]'>
            {t('rankingDetail', {
              provider: r.provider,
              model: r.model,
              day: nf.format(r.calls_24h),
              week: nf.format(r.calls_7d)
            })}
            {r.last_used_at &&
              ` · ${t('lastCall', { date: format.dateTime(new Date(r.last_used_at), { dateStyle: 'medium', timeStyle: 'short' }) })}`}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Routes({ routes }: { routes: AiRoute[] }) {
  const t = useTranslations('admin.ai');
  const format = useFormatter();
  const nf = { format: (n: number) => format.number(n) };
  const labels = useLabels();
  const apps = [...new Set(routes.map((r) => r.app))];
  return (
    <div className='space-y-5'>
      {apps.map((app) => (
        <div key={app} className='space-y-2'>
          <h4 className='text-sm font-semibold'>{labels.app(app)}</h4>
          <div className='divide-y rounded-lg border'>
            {routes
              .filter((r) => r.app === app)
              .map((r) => (
                <div key={r.task} className='space-y-2 p-3'>
                  <div className='flex flex-wrap items-baseline gap-2'>
                    <span className='text-sm font-medium'>{labels.task(r.task)}</span>
                    <code className='text-muted-foreground text-[11px]'>{r.task}</code>
                    <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
                      {t('calls30d', { count: r.calls30d })}
                    </span>
                  </div>
                  <p className='text-muted-foreground text-xs'>{r.description}</p>
                  <ol className='flex flex-wrap items-center gap-1.5'>
                    {r.steps.map((s, i) => (
                      <li key={s.position} className='flex items-center gap-1.5'>
                        {i > 0 && (
                          <span className='text-muted-foreground text-xs' aria-hidden>
                            →
                          </span>
                        )}
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs',
                            s.tier === 'paid' && 'border-amber-500/40 bg-amber-500/5'
                          )}
                          title={s.modelId}
                        >
                          <span className='text-muted-foreground tabular-nums'>{s.position}.</span>
                          {s.label}
                          {s.calls30d > 0 && (
                            <span className='text-muted-foreground tabular-nums'>
                              ({nf.format(s.calls30d)})
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** LevelUp staff: which AI models are used the most, and where. */
export function AiInsights() {
  const { data } = useSuspenseQuery(aiInsightsQueryOptions(createClient()));
  const t = useTranslations('admin.ai');
  const labels = useLabels();
  const used = data.ranking.filter((r) => r.calls_total > 0);
  const idle = data.ranking.filter((r) => r.calls_total === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
          <Stat label={t('last24h')} value={data.totals.calls24h} />
          <Stat label={t('last7d')} value={data.totals.calls7d} />
          <Stat label={t('last30d')} value={data.totals.calls30d} />
          <Stat label={t('allTime')} value={data.totals.callsTotal} />
        </div>

        <section className='space-y-3'>
          <h3 className='text-sm font-semibold'>{t('topModels')}</h3>
          {used.length === 0 ? (
            <p className='text-muted-foreground text-sm'>{t('noCalls')}</p>
          ) : (
            <Ranking rows={used} />
          )}
          {idle.length > 0 && (
            <p className='text-muted-foreground text-xs'>
              {t('neverCalled', { models: idle.map((r) => r.label).join(', ') })}
            </p>
          )}
        </section>

        <section className='space-y-3'>
          <h3 className='text-sm font-semibold'>{t('whereUsed')}</h3>
          <Routes routes={data.routes} />
          {data.unrouted.length > 0 && (
            <div className='space-y-1 text-xs'>
              <p className='font-medium'>{t('otherCalls')}</p>
              <ul className='text-muted-foreground space-y-0.5'>
                {data.unrouted.map((u) => (
                  <li key={`${u.app}-${u.task}-${u.model_id}`}>
                    {labels.app(u.app)} · {u.task} · {u.model_id} :{' '}
                    {t('calls30d', { count: u.calls_30d })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
