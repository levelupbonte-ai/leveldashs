import type { SupabaseClient } from '@supabase/supabase-js';
import { MFA_REQUIRED_MESSAGE } from '@/features/organizations/api/service';
import type {
  AiInsights,
  AiModelRank,
  AiRoute,
  AiTier,
  AiUsageStat,
  ProjectRequest,
  ProjectRequestUpdate
} from './types';

type RouteRow = {
  app: string;
  task: string;
  position: number;
  description: string;
  model_id: string;
  ai_models: { label: string; tier: AiTier } | null;
};

/** Ranking, routes (fallback order) and 24 h / 7 d / 30 d counts. Platform admins only. */
export async function getAiInsights(db: SupabaseClient): Promise<AiInsights> {
  const [ranking, routes, usage] = await Promise.all([
    db
      .from('ai_model_ranking')
      .select('*')
      .order('calls_30d', { ascending: false })
      .order('sort_order', { ascending: true }),
    db
      .from('ai_routes')
      .select('app, task, position, description, model_id, ai_models(label, tier)')
      .order('app')
      .order('task')
      .order('position'),
    db.from('ai_usage_stats').select('*')
  ]);
  if (ranking.error || routes.error || usage.error) {
    throw new Error('Impossible de charger les statistiques IA.');
  }
  const stats = (usage.data ?? []) as AiUsageStat[];
  const callsFor = (app: string, task: string, modelId?: string) =>
    stats
      .filter((s) => s.app === app && s.task === task && (!modelId || s.model_id === modelId))
      .reduce((n, s) => n + s.calls_30d, 0);

  const grouped = new Map<string, AiRoute>();
  for (const r of (routes.data ?? []) as unknown as RouteRow[]) {
    const key = `${r.app}/${r.task}`;
    const route = grouped.get(key) ?? {
      app: r.app,
      task: r.task,
      description: r.description,
      steps: [],
      calls30d: callsFor(r.app, r.task)
    };
    route.steps.push({
      position: r.position,
      modelId: r.model_id,
      label: r.ai_models?.label ?? r.model_id,
      tier: r.ai_models?.tier ?? 'free',
      calls30d: callsFor(r.app, r.task, r.model_id)
    });
    grouped.set(key, route);
  }

  return {
    ranking: (ranking.data ?? []) as AiModelRank[],
    routes: [...grouped.values()],
    unrouted: stats.filter((s) => !grouped.has(`${s.app}/${s.task}`)),
    totals: stats.reduce(
      (t, s) => ({
        calls24h: t.calls24h + s.calls_24h,
        calls7d: t.calls7d + s.calls_7d,
        calls30d: t.calls30d + s.calls_30d,
        callsTotal: t.callsTotal + s.calls_total
      }),
      { calls24h: 0, calls7d: 0, calls30d: 0, callsTotal: 0 }
    )
  };
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** Project requests, best AI score first, then newest. Platform admins only. */
export async function listProjectRequests(db: SupabaseClient): Promise<ProjectRequest[]> {
  const { data, error } = await db
    .from('project_requests')
    .select('*')
    .order('ai_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(300);
  // Table not created yet on this project: nothing to review.
  if (error?.code === 'PGRST205' || error?.code === '42P01') return [];
  if (error) throw new Error('Impossible de charger les demandes de projet.');
  return (data ?? []).map((row) => ({
    ...(row as ProjectRequest),
    social_links: asStrings(row.social_links),
    proof_links: asStrings(row.proof_links),
    ai_reasons: asStrings(row.ai_reasons),
    ai_red_flags: asStrings(row.ai_red_flags),
    brief: row.brief && typeof row.brief === 'object' ? (row.brief as Record<string, unknown>) : {}
  }));
}

/**
 * Staff follow-up (status, notes). The database requires an aal2 session for
 * accounts with an authenticator app: a refused update returns no row.
 */
export async function updateProjectRequest(db: SupabaseClient, input: ProjectRequestUpdate) {
  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) throw new Error('Session expirée. Reconnectez-vous.');
  const { error, count } = await db
    .from('project_requests')
    .update(
      {
        status: input.status,
        notes: input.notes.trim().slice(0, 4000) || null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString()
      },
      { count: 'exact' }
    )
    .eq('id', input.id);
  if (error?.message.includes('aal2')) throw new Error(MFA_REQUIRED_MESSAGE);
  if (error || !count) {
    const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
    throw new Error(
      aal && aal.currentLevel !== 'aal2' && aal.nextLevel === 'aal2'
        ? MFA_REQUIRED_MESSAGE
        : 'Modification impossible (réservé à l’équipe LevelUp).'
    );
  }
}
