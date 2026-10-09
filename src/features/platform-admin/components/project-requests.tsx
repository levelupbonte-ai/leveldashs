'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { adminInsightKeys, projectRequestsQueryOptions } from '../api/queries';
import { updateProjectRequest } from '../api/service';
import type { ProjectRequest, ProjectStatus, ProjectVerdict } from '../api/types';

const TABS: { value: ProjectVerdict; label: string }[] = [
  { value: 'qualified', label: 'Qualifiées' },
  { value: 'review', label: 'À vérifier' },
  { value: 'rejected', label: 'Écartées' }
];

const STATUS_LABELS: Record<ProjectStatus, string> = {
  new: 'Nouvelle',
  contacted: 'Contacté',
  demo: 'Démo',
  won: 'Gagné',
  lost: 'Perdu',
  rejected: 'Refusé'
};

// Anything the AI did not settle (null or malformed) needs a human look.
const tabOf = (r: ProjectRequest): ProjectVerdict =>
  r.ai_verdict === 'qualified' || r.ai_verdict === 'rejected' ? r.ai_verdict : 'review';

/** Only http(s) links are clickable; bare domains get https://. */
function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function ExternalLink({ href, label }: { href: string; label?: string }) {
  const url = safeHref(href);
  if (!url) return <span className='text-muted-foreground break-all'>{href}</span>;
  return (
    <a
      href={url}
      target='_blank'
      rel='noopener noreferrer nofollow'
      className='text-primary inline-flex max-w-full items-center gap-1 break-all underline-offset-4 hover:underline'
    >
      {label ?? url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
      <Icons.externalLink className='size-3 shrink-0' aria-hidden />
    </a>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  const tone =
    score == null
      ? 'bg-muted text-muted-foreground'
      : score >= 70
        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
        : score >= 40
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
          : 'bg-red-500/15 text-red-700 dark:text-red-400';
  return (
    <span
      className={cn(
        'inline-flex h-7 min-w-11 items-center justify-center rounded-md px-2 text-sm font-semibold tabular-nums',
        tone
      )}
      title='Score de qualification IA (0 à 100)'
    >
      {score ?? '—'}
    </span>
  );
}

function briefEntries(brief: Record<string, unknown>) {
  return Object.entries(brief)
    .map(([k, v]) => [
      k,
      typeof v === 'string'
        ? v
        : Array.isArray(v)
          ? v.filter((x) => typeof x === 'string').join(', ')
          : v == null
            ? ''
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v)
    ])
    .filter(([, v]) => v);
}

function RequestCard({ request: r }: { request: ProjectRequest }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(r.notes ?? '');
  const save = useMutation({
    mutationFn: (input: { status: ProjectStatus; notes: string }) =>
      updateProjectRequest(createClient(), { id: r.id, ...input }),
    onSuccess: () => {
      toast.success('Demande mise à jour.');
      void queryClient.invalidateQueries({ queryKey: adminInsightKeys.projectRequests() });
    },
    onError: (e) => toast.error(e.message)
  });
  const links = [
    ...(r.website ? [{ href: r.website, kind: 'Site' }] : []),
    ...r.social_links.map((href) => ({ href, kind: 'Réseau' })),
    ...r.proof_links.map((href) => ({ href, kind: 'Preuve' }))
  ];
  const brief = briefEntries(r.brief);

  return (
    <article className='space-y-3 rounded-lg border p-4'>
      <header className='flex items-start gap-3'>
        <ScoreBadge score={r.ai_score} />
        <div className='min-w-0 flex-1'>
          <h4 className='truncate font-semibold'>{r.business_name || r.name}</h4>
          <p className='text-muted-foreground text-xs'>
            {[r.sector, r.project_type, r.business_stage, r.business_age]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <span className='text-muted-foreground shrink-0 text-xs'>
          {new Date(r.created_at).toLocaleDateString('fr-FR')}
        </span>
      </header>

      {r.ai_summary && <p className='text-sm'>{r.ai_summary}</p>}

      {(r.ai_reasons.length > 0 || r.ai_red_flags.length > 0) && (
        <div className='grid grid-cols-1 gap-3 text-xs sm:grid-cols-2'>
          {r.ai_reasons.length > 0 && (
            <ul className='space-y-1'>
              {r.ai_reasons.map((reason) => (
                <li key={reason} className='flex gap-1.5'>
                  <Icons.check
                    className='mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400'
                    aria-hidden
                  />
                  {reason}
                </li>
              ))}
            </ul>
          )}
          {r.ai_red_flags.length > 0 && (
            <ul className='space-y-1'>
              {r.ai_red_flags.map((flag) => (
                <li key={flag} className='flex gap-1.5'>
                  <Icons.warning
                    className='mt-0.5 size-3.5 shrink-0 text-red-600 dark:text-red-400'
                    aria-hidden
                  />
                  {flag}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <dl className='grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2'>
        <div className='flex gap-1.5'>
          <dt className='text-muted-foreground'>Contact :</dt>
          <dd className='min-w-0'>
            {r.name} ·{' '}
            <a href={`mailto:${r.email}`} className='text-primary break-all hover:underline'>
              {r.email}
            </a>
            {r.phone && (
              <>
                {' · '}
                <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`} className='hover:underline'>
                  {r.phone}
                </a>
              </>
            )}
          </dd>
        </div>
        {(r.budget || r.timeline) && (
          <div className='flex gap-1.5'>
            <dt className='text-muted-foreground'>Budget / délai :</dt>
            <dd>{[r.budget, r.timeline].filter(Boolean).join(' · ')}</dd>
          </div>
        )}
        {r.registration_number && (
          <div className='flex gap-1.5'>
            <dt className='text-muted-foreground'>N° d’immatriculation :</dt>
            <dd>{r.registration_number}</dd>
          </div>
        )}
        {r.locale && (
          <div className='flex gap-1.5'>
            <dt className='text-muted-foreground'>Langue :</dt>
            <dd>{r.locale}</dd>
          </div>
        )}
      </dl>

      {links.length > 0 && (
        <ul className='flex flex-col gap-1 text-xs'>
          {links.map((l) => (
            <li key={`${l.kind}-${l.href}`} className='flex gap-1.5'>
              <span className='text-muted-foreground w-12 shrink-0'>{l.kind}</span>
              <ExternalLink href={l.href} />
            </li>
          ))}
        </ul>
      )}

      {brief.length > 0 && (
        <details className='text-xs'>
          <summary className='text-muted-foreground cursor-pointer'>Brief complet</summary>
          <dl className='mt-2 space-y-1'>
            {brief.map(([k, v]) => (
              <div key={k}>
                <dt className='text-muted-foreground inline'>{k} : </dt>
                <dd className='inline whitespace-pre-wrap'>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      <div className='flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-start'>
        <NativeSelect
          aria-label='Statut du suivi'
          value={r.status}
          disabled={save.isPending}
          onChange={(e) => save.mutate({ status: e.target.value as ProjectStatus, notes })}
          className='sm:w-40'
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Textarea
          aria-label='Notes internes'
          placeholder='Notes internes (visibles par l’équipe LevelUp)'
          value={notes}
          maxLength={4000}
          onChange={(e) => setNotes(e.target.value)}
          className='min-h-9 flex-1 text-sm'
          rows={1}
        />
        <Button
          size='sm'
          variant='outline'
          disabled={save.isPending || notes === (r.notes ?? '')}
          onClick={() => save.mutate({ status: r.status, notes })}
        >
          Enregistrer
        </Button>
      </div>
      {r.reviewed_at && (
        <p className='text-muted-foreground text-[11px]'>
          Dernier suivi le {new Date(r.reviewed_at).toLocaleString('fr-FR')}
          {r.ai_model && ` · analyse IA : ${r.ai_model}`}
        </p>
      )}
    </article>
  );
}

/** LevelUp staff: project requests from levelup-ecosystem.com, sorted by AI score. */
export function ProjectRequests() {
  const { data } = useSuspenseQuery(projectRequestsQueryOptions(createClient()));
  const byTab = (tab: ProjectVerdict) => data.filter((r) => tabOf(r) === tab);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Demandes de projet</CardTitle>
        <CardDescription>
          Formulaire « Démarrer un projet » de levelup-ecosystem.com. L’IA donne un score et un avis
          indicatifs : vérifiez les liens avant de proposer une démo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue='qualified'>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                <span className='text-muted-foreground ml-1 tabular-nums'>
                  {byTab(t.value).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {TABS.map((t) => {
            const rows = byTab(t.value);
            return (
              <TabsContent key={t.value} value={t.value} className='space-y-3 pt-2'>
                {rows.length === 0 ? (
                  <p className='text-muted-foreground text-sm'>Aucune demande ici.</p>
                ) : (
                  rows.map((r) => <RequestCard key={r.id} request={r} />)
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>
    </Card>
  );
}
