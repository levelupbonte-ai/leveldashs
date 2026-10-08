-- Which AI answered, per app: lets LevelUp watch the paid provider (DeepSeek)
-- and the free tiers. No prompt or user content is stored, only counters.

create table if not exists public.ai_calls (
  id bigint generated always as identity primary key,
  app text not null check (app in ('studio', 'dashboard', 'site')),
  task text not null check (char_length(task) between 1 and 40),
  provider text not null check (provider in ('groq', 'cerebras', 'mistral', 'openrouter', 'deepseek', 'gemini')),
  model text not null check (char_length(model) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists ai_calls_created_idx on public.ai_calls (created_at desc);
alter table public.ai_calls enable row level security;
revoke all on public.ai_calls from public, anon, authenticated;

-- Dashboard (signed-in user, publishable key): record one call. Bad values are ignored.
create or replace function public.log_ai_call(p_task text, p_provider text, p_model text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  insert into public.ai_calls (app, task, provider, model)
  values ('dashboard', left(coalesce(p_task, ''), 40), p_provider, left(coalesce(p_model, ''), 80));
exception when check_violation or not_null_violation then
  return;
end;
$$;
revoke all on function public.log_ai_call(text, text, text) from public, anon;
grant execute on function public.log_ai_call(text, text, text) to authenticated;

-- Platform admins only: calls per app / provider / model over the last N days.
create or replace function public.ai_usage_summary(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.platform_admins where user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.calls desc)
    from (
      select app, provider, model, count(*)::int as calls
      from public.ai_calls
      where created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 90)))
      group by app, provider, model
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.ai_usage_summary(int) from public, anon;
grant execute on function public.ai_usage_summary(int) to authenticated;
