-- One offer everywhere. The monthly plans a client can choose are Essential
-- (39 USD) and Pro (99 USD); the showcase reads them from here, so the site,
-- the dashboard and the invoices always show the same names and prices.
--
--   plans.listed            false: kept for the organizations already on it
--                           (renewals keep working) but no longer offered
--   public.levelup_offer()  the plans on offer, for the public website

-- @part 1: plans -------------------------------------------------------------------

alter table public.plans add column if not exists listed boolean not null default true;

update public.plans set name = 'Essential', price_monthly = 3900, sort_order = 10 where key = 'starter';
update public.plans set name = 'Pro', price_monthly = 9900, sort_order = 20 where key = 'pro';
update public.plans set listed = false, sort_order = 30 where key = 'business';

-- @part 2: only listed plans can be chosen -----------------------------------------
-- The three functions are patched in place (same bodies, one condition added).

do $$
declare
  v_def text;
  v_new text;
begin
  -- The plan list a client sees: listed plans, plus the one they are on.
  v_def := pg_get_functiondef('public.billing_summary(uuid)'::regprocedure);
  v_new := replace(v_def, 'from public.plans p where p.active or p.key = v_plan.key',
    'from public.plans p where (p.active and p.listed) or p.key = v_plan.key');
  if v_new = v_def and position('p.listed' in v_def) = 0 then
    raise exception 'billing_summary: pattern not found';
  end if;
  execute v_new;

  -- Asking for a plan, or paying for one online: listed plans only.
  foreach v_def in array array[
    pg_get_functiondef('public.request_plan_upgrade(uuid, text, text)'::regprocedure),
    pg_get_functiondef('public.billing_plan_charge(uuid, text)'::regprocedure)
  ] loop
    v_new := replace(v_def, 'from public.plans where key = p_plan_key and active;',
      'from public.plans where key = p_plan_key and active and listed;');
    if v_new = v_def and position('and listed;' in v_def) = 0 then
      raise exception 'plan choice: pattern not found';
    end if;
    execute v_new;
  end loop;
end;
$$;

-- @part 3: the public offer ----------------------------------------------------------

create or replace function public.levelup_offer()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('plans', coalesce(jsonb_agg(jsonb_build_object(
      'key', p.key, 'name', p.name, 'price_monthly', p.price_monthly, 'currency', p.currency,
      'features', to_jsonb(p.features))
    order by p.sort_order), '[]'::jsonb))
  from public.plans p
  where p.active and p.listed and coalesce(p.price_monthly, 0) > 0;
$$;

revoke all on function public.levelup_offer() from public;
grant execute on function public.levelup_offer() to anon, authenticated;
