-- AI catalog and usage: every model LevelUp apps can call, where each one is
-- used (per app and task, in fallback order) and how much it is used.
--
-- * public.ai_models  — one row per provider:model (free/paid tier, strengths)
-- * public.ai_routes  — app + task -> ordered models, with a French description
--                       of where it shows up in the product
-- * public.ai_usage_stats   — calls per app/task/provider/model (24 h, 7 d, 30 d, total)
-- * public.ai_model_ranking — models ranked by calls over 30 days, with share
--
-- Seeded from the default routes in the code (AI_ROUTE_<TASK> env overrides are
-- not reflected): leveldashs src/lib/ai/router.ts, levelstudio
-- server/lib/ai-router.ts, app.levelup-ecosystem src/lib/ai/router.ts.
-- LevelUp staff (platform admins) read everything; nobody writes from the API.

create table if not exists public.ai_models (
  id text primary key check (id = provider || ':' || model),
  provider text not null check (provider in ('groq', 'cerebras', 'mistral', 'openrouter', 'deepseek', 'gemini')),
  model text not null check (char_length(model) between 1 and 80),
  label text not null,
  tier text not null check (tier in ('free', 'paid')),
  cost_note text,
  strengths text,
  apps text[] not null default '{}',
  tasks text[] not null default '{}',
  is_active boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_routes (
  app text not null check (app in ('dashboard', 'studio', 'showcase', 'site')),
  task text not null check (char_length(task) between 1 and 40),
  position int not null check (position >= 1),
  model_id text not null references public.ai_models (id) on update cascade,
  description text not null,
  primary key (app, task, position)
);
create index if not exists ai_routes_model_idx on public.ai_routes (model_id);
create index if not exists ai_calls_created_idx on public.ai_calls (created_at desc);

-- ------------------------------------------------------------------ access

alter table public.ai_models enable row level security;
alter table public.ai_routes enable row level security;
revoke all on public.ai_models, public.ai_routes from public, anon, authenticated;
grant select on public.ai_models, public.ai_routes to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_models' and policyname = 'ai_models_select_platform_admin') then
    create policy ai_models_select_platform_admin on public.ai_models
      for select to authenticated using ((select private.is_platform_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_routes' and policyname = 'ai_routes_select_platform_admin') then
    create policy ai_routes_select_platform_admin on public.ai_routes
      for select to authenticated using ((select private.is_platform_admin()));
  end if;
  -- ai_calls had RLS on and no policy (service role / SECURITY DEFINER writes
  -- only). Staff may now read it; still no insert/update/delete for clients.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_calls' and policyname = 'ai_calls_select_platform_admin') then
    create policy ai_calls_select_platform_admin on public.ai_calls
      for select to authenticated using ((select private.is_platform_admin()));
  end if;
end;
$$;

alter table public.ai_calls enable row level security;
revoke all on public.ai_calls from anon, authenticated;
grant select on public.ai_calls to authenticated;

-- ------------------------------------------------------------------ catalog

insert into public.ai_models (id, provider, model, label, tier, cost_note, strengths, sort_order) values
  ('groq:openai/gpt-oss-120b', 'groq', 'openai/gpt-oss-120b', 'GPT-OSS 120B (Groq)', 'free',
   'Offre gratuite Groq (limites par minute et par jour)',
   'Raisonnement rapide, appels d’outils, réponses structurées (JSON)', 10),
  ('cerebras:gpt-oss-120b', 'cerebras', 'gpt-oss-120b', 'GPT-OSS 120B (Cerebras)', 'free',
   'Offre gratuite Cerebras (limites par minute et par jour)',
   'Très rapide, même modèle que sur Groq : relais quand Groq est saturé', 20),
  ('groq:openai/gpt-oss-20b', 'groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B (Groq)', 'free',
   'Offre gratuite Groq',
   'Petit modèle très rapide pour les textes courts', 30),
  ('groq:meta-llama/llama-4-scout-17b-16e-instruct', 'groq', 'meta-llama/llama-4-scout-17b-16e-instruct',
   'Llama 4 Scout (Groq)', 'free', 'Offre gratuite Groq',
   'Lecture d’images (vision), relais de Gemini', 40),
  ('mistral:mistral-small-latest', 'mistral', 'mistral-small-latest', 'Mistral Small', 'free',
   'Offre gratuite Mistral (« Experiment »)',
   'Bon en français, rédaction et reformulation', 50),
  ('gemini:gemini-3.5-flash', 'gemini', 'gemini-3.5-flash', 'Gemini 3.5 Flash', 'free',
   'Offre gratuite Google AI Studio (rotation de plusieurs clés)',
   'Génération longue (pages HTML complètes), multimodal', 60),
  ('gemini:gemini-3-flash-preview', 'gemini', 'gemini-3-flash-preview', 'Gemini 3 Flash (preview)', 'free',
   'Offre gratuite Google AI Studio',
   'Relais de Gemini 3.5 Flash pour la génération longue, vision', 70),
  ('gemini:gemini-3.1-flash-lite', 'gemini', 'gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite', 'free',
   'Offre gratuite Google AI Studio (quota le plus large)',
   'Filet de sécurité gratuit de presque toutes les routes, vision rapide', 80),
  ('deepseek:deepseek-chat', 'deepseek', 'deepseek-chat', 'DeepSeek Chat', 'paid',
   'Payant à l’usage (faible coût) : seul fournisseur facturé',
   'Meilleure plume pour les textes clients, relais payant quand les offres gratuites sont épuisées', 90),
  ('openrouter:deepseek/deepseek-chat', 'openrouter', 'deepseek/deepseek-chat', 'DeepSeek Chat (OpenRouter)', 'paid',
   'Payant via OpenRouter (crédits)',
   'Second accès à DeepSeek si l’API DeepSeek est indisponible', 100)
on conflict (id) do update set
  provider = excluded.provider,
  model = excluded.model,
  label = excluded.label,
  tier = excluded.tier,
  cost_note = excluded.cost_note,
  strengths = excluded.strengths,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

insert into public.ai_routes (app, task, position, model_id, description) values
  -- Dashboard (leveldashs)
  ('dashboard', 'agents', 1, 'cerebras:gpt-oss-120b', 'Tableau de bord — assistant IA du site (conversation, lecture du contenu, propositions de modifications)'),
  ('dashboard', 'agents', 2, 'groq:openai/gpt-oss-120b', 'Tableau de bord — assistant IA du site (conversation, lecture du contenu, propositions de modifications)'),
  ('dashboard', 'agents', 3, 'mistral:mistral-small-latest', 'Tableau de bord — assistant IA du site (conversation, lecture du contenu, propositions de modifications)'),
  ('dashboard', 'agents', 4, 'gemini:gemini-3.1-flash-lite', 'Tableau de bord — assistant IA du site (conversation, lecture du contenu, propositions de modifications)'),
  ('dashboard', 'writing', 1, 'deepseek:deepseek-chat', 'Tableau de bord — rédaction des textes proposés au client (descriptions, FAQ, titres et descriptions Google)'),
  ('dashboard', 'writing', 2, 'mistral:mistral-small-latest', 'Tableau de bord — rédaction des textes proposés au client (descriptions, FAQ, titres et descriptions Google)'),
  ('dashboard', 'writing', 3, 'groq:openai/gpt-oss-120b', 'Tableau de bord — rédaction des textes proposés au client (descriptions, FAQ, titres et descriptions Google)'),
  ('dashboard', 'writing', 4, 'gemini:gemini-3.1-flash-lite', 'Tableau de bord — rédaction des textes proposés au client (descriptions, FAQ, titres et descriptions Google)'),
  ('dashboard', 'reports', 1, 'groq:openai/gpt-oss-120b', 'Tableau de bord — résumé hebdomadaire de l’activité du site'),
  ('dashboard', 'reports', 2, 'cerebras:gpt-oss-120b', 'Tableau de bord — résumé hebdomadaire de l’activité du site'),
  ('dashboard', 'reports', 3, 'gemini:gemini-3.1-flash-lite', 'Tableau de bord — résumé hebdomadaire de l’activité du site'),
  -- LevelStudio
  ('studio', 'studio_chat', 1, 'groq:openai/gpt-oss-120b', 'LevelStudio — conversation avec le client (questions, plan du site, idées de brief, lecture des documents texte)'),
  ('studio', 'studio_chat', 2, 'cerebras:gpt-oss-120b', 'LevelStudio — conversation avec le client (questions, plan du site, idées de brief, lecture des documents texte)'),
  ('studio', 'studio_chat', 3, 'gemini:gemini-3.1-flash-lite', 'LevelStudio — conversation avec le client (questions, plan du site, idées de brief, lecture des documents texte)'),
  ('studio', 'studio_chat', 4, 'deepseek:deepseek-chat', 'LevelStudio — conversation avec le client (questions, plan du site, idées de brief, lecture des documents texte)'),
  ('studio', 'studio_build', 1, 'gemini:gemini-3.5-flash', 'LevelStudio — écriture des pages du site (HTML complet)'),
  ('studio', 'studio_build', 2, 'gemini:gemini-3-flash-preview', 'LevelStudio — écriture des pages du site (HTML complet)'),
  ('studio', 'studio_build', 3, 'deepseek:deepseek-chat', 'LevelStudio — écriture des pages du site (HTML complet)'),
  ('studio', 'studio_build', 4, 'openrouter:deepseek/deepseek-chat', 'LevelStudio — écriture des pages du site (HTML complet)'),
  ('studio', 'studio_build', 5, 'gemini:gemini-3.1-flash-lite', 'LevelStudio — écriture des pages du site (HTML complet)'),
  ('studio', 'studio_review', 1, 'cerebras:gpt-oss-120b', 'LevelStudio — relecture du site terminé avant livraison'),
  ('studio', 'studio_review', 2, 'groq:openai/gpt-oss-120b', 'LevelStudio — relecture du site terminé avant livraison'),
  ('studio', 'studio_review', 3, 'gemini:gemini-3.1-flash-lite', 'LevelStudio — relecture du site terminé avant livraison'),
  ('studio', 'studio_review', 4, 'deepseek:deepseek-chat', 'LevelStudio — relecture du site terminé avant livraison'),
  ('studio', 'vision', 1, 'gemini:gemini-3.1-flash-lite', 'LevelStudio — analyse des images et PDF envoyés (logo, photos, menus, captures)'),
  ('studio', 'vision', 2, 'groq:meta-llama/llama-4-scout-17b-16e-instruct', 'LevelStudio — analyse des images et PDF envoyés (logo, photos, menus, captures)'),
  ('studio', 'vision', 3, 'gemini:gemini-3-flash-preview', 'LevelStudio — analyse des images et PDF envoyés (logo, photos, menus, captures)'),
  -- levelup-ecosystem.com (showcase)
  ('showcase', 'site', 1, 'groq:openai/gpt-oss-20b', 'levelup-ecosystem.com — récapitulatif du brief « Démarrer un projet » envoyé au visiteur'),
  ('showcase', 'site', 2, 'mistral:mistral-small-latest', 'levelup-ecosystem.com — récapitulatif du brief « Démarrer un projet » envoyé au visiteur'),
  ('showcase', 'site', 3, 'gemini:gemini-3.1-flash-lite', 'levelup-ecosystem.com — récapitulatif du brief « Démarrer un projet » envoyé au visiteur')
on conflict (app, task, position) do update set
  model_id = excluded.model_id,
  description = excluded.description;

-- apps / tasks of each model, derived from the routes above.
update public.ai_models m set
  apps = coalesce((select array_agg(distinct r.app order by r.app) from public.ai_routes r where r.model_id = m.id), '{}'),
  tasks = coalesce((select array_agg(distinct r.task order by r.task) from public.ai_routes r where r.model_id = m.id), '{}'),
  updated_at = now();

-- ------------------------------------------------------------------ views

create or replace view public.ai_usage_stats
with (security_invoker = true) as
select
  c.app,
  c.task,
  c.provider,
  c.model,
  c.provider || ':' || c.model as model_id,
  count(*) filter (where c.created_at > now() - interval '24 hours')::int as calls_24h,
  count(*) filter (where c.created_at > now() - interval '7 days')::int as calls_7d,
  count(*) filter (where c.created_at > now() - interval '30 days')::int as calls_30d,
  count(*)::int as calls_total,
  max(c.created_at) as last_used_at
from public.ai_calls c
group by c.app, c.task, c.provider, c.model;

create or replace view public.ai_model_ranking
with (security_invoker = true) as
with usage as (
  select
    c.provider || ':' || c.model as model_id,
    c.provider,
    c.model,
    count(*) filter (where c.created_at > now() - interval '24 hours')::int as calls_24h,
    count(*) filter (where c.created_at > now() - interval '7 days')::int as calls_7d,
    count(*) filter (where c.created_at > now() - interval '30 days')::int as calls_30d,
    count(*)::int as calls_total,
    max(c.created_at) as last_used_at
  from public.ai_calls c
  group by c.provider, c.model
), merged as (
  select
    coalesce(m.id, u.model_id) as model_id,
    coalesce(m.provider, u.provider) as provider,
    coalesce(m.model, u.model) as model,
    coalesce(m.label, u.model) as label,
    m.tier,
    m.is_active,
    m.sort_order,
    coalesce(u.calls_24h, 0) as calls_24h,
    coalesce(u.calls_7d, 0) as calls_7d,
    coalesce(u.calls_30d, 0) as calls_30d,
    coalesce(u.calls_total, 0) as calls_total,
    u.last_used_at
  from public.ai_models m
  full join usage u on u.model_id = m.id
)
select
  merged.*,
  round(100.0 * merged.calls_30d / nullif(sum(merged.calls_30d) over (), 0), 1) as share_30d,
  (rank() over (order by merged.calls_30d desc))::int as rank_30d
from merged;

revoke all on public.ai_usage_stats, public.ai_model_ranking from public, anon, authenticated;
grant select on public.ai_usage_stats, public.ai_model_ranking to authenticated;

comment on table public.ai_models is 'AI models LevelUp apps can call (seeded from the default routes in code). Platform admins read.';
comment on table public.ai_routes is 'Where each model is used: app + task, fallback order, French description. Platform admins read.';
comment on view public.ai_usage_stats is 'AI calls per app/task/provider/model over 24 h / 7 d / 30 d / total (security_invoker: platform admins only).';
comment on view public.ai_model_ranking is 'Models ranked by calls over 30 days with share in percent (security_invoker: platform admins only).';
