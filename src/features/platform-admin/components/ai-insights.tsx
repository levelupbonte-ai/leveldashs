'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { aiInsightsQueryOptions } from '../api/queries';
import type { AiModelRank, AiRoute, AiTier } from '../api/types';

const APP_LABELS: Record<string, string> = {
  dashboard: 'Tableau de bord',
  studio: 'LevelStudio',
  showcase: 'levelup-ecosystem.com',
  site: 'Site vitrine'
};

const TASK_LABELS: Record<string, string> = {
  agents: 'Assistant',
  writing: 'Rédaction',
  reports: 'Rapports',
  site: 'Récapitulatif de brief',
  studio_chat: 'Conversation',
  studio_build: 'Création des pages',
  studio_review: 'Relecture',
  vision: 'Images et PDF'
};

const nf = new Intl.NumberFormat('fr-FR');

function TierBadge({ tier }: { tier: AiTier | null }) {
  if (!tier) return <Badge variant='outline'>Hors catalogue</Badge>;
  return tier === 'paid' ? (
    <Badge className='border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'>
      Payant
    </Badge>
  ) : (
    <Badge variant='secondary'>Gratuit</Badge>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className='rounded-lg border p-3'>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p className='text-2xl font-semibold tabular-nums'>{nf.format(value)}</p>
    </div>
  );
}

function Ranking({ rows }: { rows: AiModelRank[] }) {
  const max = Math.max(1, ...rows.map((r) => r.calls_30d));
  return (
    <ol className='space-y-2.5'>
      {rows.map((r) => (
        <li key={r.model_id} className='space-y-1'>
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <span className='font-medium'>{r.label}</span>
            <TierBadge tier={r.tier} />
            <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
              {nf.format(r.calls_30d)} appels
              {r.share_30d != null && ` · ${r.share_30d.toLocaleString('fr-FR')} %`}
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
            {r.provider} · {r.model} · 24 h : {nf.format(r.calls_24h)} · 7 j :{' '}
            {nf.format(r.calls_7d)}
            {r.last_used_at &&
              ` · dernier appel ${new Date(r.last_used_at).toLocaleString('fr-FR')}`}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Routes({ routes }: { routes: AiRoute[] }) {
  const apps = [...new Set(routes.map((r) => r.app))];
  return (
    <div className='space-y-5'>
      {apps.map((app) => (
        <div key={app} className='space-y-2'>
          <h4 className='text-sm font-semibold'>{APP_LABELS[app] ?? app}</h4>
          <div className='divide-y rounded-lg border'>
            {routes
              .filter((r) => r.app === app)
              .map((r) => (
                <div key={r.task} className='space-y-2 p-3'>
                  <div className='flex flex-wrap items-baseline gap-2'>
                    <span className='text-sm font-medium'>{TASK_LABELS[r.task] ?? r.task}</span>
                    <code className='text-muted-foreground text-[11px]'>{r.task}</code>
                    <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
                      {nf.format(r.calls30d)} appels (30 j)
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
  const used = data.ranking.filter((r) => r.calls_total > 0);
  const idle = data.ranking.filter((r) => r.calls_total === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Intelligence artificielle</CardTitle>
        <CardDescription>
          Modèles utilisés par les applications LevelUp, du plus au moins sollicité, et où chacun
          intervient. Chaque tâche essaie les modèles dans l’ordre et passe au suivant en cas de
          quota ou de panne. DeepSeek est le seul fournisseur payant.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
          <Stat label='Dernières 24 h' value={data.totals.calls24h} />
          <Stat label='7 derniers jours' value={data.totals.calls7d} />
          <Stat label='30 derniers jours' value={data.totals.calls30d} />
          <Stat label='Depuis le début' value={data.totals.callsTotal} />
        </div>

        <section className='space-y-3'>
          <h3 className='text-sm font-semibold'>Modèles les plus utilisés (30 jours)</h3>
          {used.length === 0 ? (
            <p className='text-muted-foreground text-sm'>Aucun appel enregistré pour le moment.</p>
          ) : (
            <Ranking rows={used} />
          )}
          {idle.length > 0 && (
            <p className='text-muted-foreground text-xs'>
              Jamais appelés pour l’instant : {idle.map((r) => r.label).join(', ')}.
            </p>
          )}
        </section>

        <section className='space-y-3'>
          <h3 className='text-sm font-semibold'>Où chaque IA est utilisée</h3>
          <Routes routes={data.routes} />
          {data.unrouted.length > 0 && (
            <div className='space-y-1 text-xs'>
              <p className='font-medium'>Autres appels enregistrés (hors catalogue)</p>
              <ul className='text-muted-foreground space-y-0.5'>
                {data.unrouted.map((u) => (
                  <li key={`${u.app}-${u.task}-${u.model_id}`}>
                    {APP_LABELS[u.app] ?? u.app} · {u.task} · {u.model_id} :{' '}
                    {nf.format(u.calls_30d)} appels (30 j)
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
