-- Automatic monthly payment on Square (LevelUp's own payment provider; Stripe is
-- not used for LevelUp). The card is entered in Square's secure fields (Web
-- Payments SDK), saved on the client's Square customer and charged by a Square
-- subscription each month. LevelUp keeps the card's brand, last 4 digits and
-- expiry only. Each paid Square invoice becomes a paid charge, once.

alter table private.billing_subscriptions drop constraint if exists billing_subscriptions_provider_check;
alter table private.billing_subscriptions drop constraint if exists billing_subscriptions_customer_id_check;
alter table private.billing_subscriptions drop constraint if exists billing_subscriptions_subscription_id_check;
alter table private.billing_subscriptions alter column provider set default 'square';
alter table private.billing_subscriptions add constraint billing_subscriptions_provider_check check (provider in ('square', 'stripe'));
alter table private.billing_subscriptions add constraint billing_subscriptions_customer_id_check check (customer_id ~ '^[A-Za-z0-9_-]{6,64}$');
alter table private.billing_subscriptions add constraint billing_subscriptions_subscription_id_check check (subscription_id is null or subscription_id ~ '^[A-Za-z0-9_-]{6,64}$');
alter table private.billing_subscriptions add column if not exists card_id text check (card_id is null or card_id ~ '^[A-Za-z0-9_:-]{6,128}$');

-- The Square catalog plan variation of each LevelUp plan at a given price.
create table if not exists private.billing_square_plans (
  plan_key text not null references public.plans (key) on delete cascade,
  amount integer not null check (amount > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  variation_id text not null check (variation_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  livemode boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (plan_key, amount, currency, livemode)
);
alter table private.billing_square_plans enable row level security;
revoke all on private.billing_square_plans from public, anon, authenticated;

drop function if exists public.billing_autopay_customer(text, uuid, text, boolean);

create or replace function public.billing_autopay_prepare(p_org uuid, p_plan_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.billing_subscriptions;
  v_plan public.plans;
  v_org public.organizations;
begin
  if auth.uid() is null or p_org is null or not private.has_org_role(p_org, 'admin') then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  perform private.hit_rate_limit('billing_autopay', p_org::text, 30, interval '1 hour');
  select * into v_org from public.organizations where id = p_org;
  select * into s from private.billing_subscriptions where organization_id = p_org;
  if p_plan_key is not null then
    select * into v_plan from public.plans where key = p_plan_key and active and listed;
    if not found then
      raise exception 'plan_not_found' using errcode = 'PT404';
    end if;
    if v_plan.price_monthly is null or v_plan.price_monthly <= 0 then
      raise exception 'price_not_set' using errcode = 'PT409';
    end if;
  end if;
  return jsonb_build_object(
    'organization_id', p_org,
    'organization_name', v_org.name,
    'email', (select u.email from auth.users u where u.id = auth.uid()),
    'provider', s.provider,
    'customer_id', s.customer_id,
    'subscription_id', s.subscription_id,
    'card_id', s.card_id,
    'status', coalesce(s.status, 'none'),
    'plan_key', s.plan_key,
    'current_plan', private.org_plan_key(p_org),
    'plan', case when v_plan.key is not null then jsonb_build_object(
      'key', v_plan.key, 'name', v_plan.name, 'amount', v_plan.price_monthly, 'currency', lower(v_plan.currency)) end,
    'variations', coalesce((select jsonb_object_agg(sp.livemode::text, sp.variation_id)
      from private.billing_square_plans sp
      where sp.plan_key = v_plan.key and sp.amount = v_plan.price_monthly and sp.currency = lower(v_plan.currency)), '{}'::jsonb));
end;
$$;

-- Server (billing key): the customer created for an organization, before its first subscription.
create or replace function public.billing_autopay_customer(p_key text, p_org uuid, p_provider text, p_customer text, p_live boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_billing_key(p_key);
  if p_org is null or p_provider not in ('square', 'stripe') or p_customer is null or p_customer !~ '^[A-Za-z0-9_-]{6,64}$' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  insert into private.billing_subscriptions (organization_id, provider, customer_id, livemode)
  values (p_org, p_provider, p_customer, coalesce(p_live, false))
  on conflict (organization_id) do update set provider = excluded.provider, customer_id = excluded.customer_id, updated_at = now()
  where private.billing_subscriptions.subscription_id is null
     or private.billing_subscriptions.status in ('canceled', 'incomplete_expired');
  return jsonb_build_object('ok', true);
end;
$$;

-- Server (billing key): the Square plan variation made for a plan's price.
create or replace function public.billing_autopay_plan_put(p_key text, p_plan_key text, p_amount integer, p_currency text, p_variation text, p_live boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_billing_key(p_key);
  if p_variation is null or p_variation !~ '^[A-Za-z0-9_-]{6,64}$' or p_amount is null or p_amount <= 0 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  insert into private.billing_square_plans (plan_key, amount, currency, variation_id, livemode)
  values (p_plan_key, p_amount, lower(p_currency), p_variation, coalesce(p_live, true))
  on conflict (plan_key, amount, currency, livemode) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

/*
 * The state of a subscription, read back from the provider by the server:
 * { provider, organization_id?, customer_id, subscription_id, card_id?, status,
 *   plan_key, amount, currency, cancel_at_period_end, current_period_end (unix),
 *   livemode, card: { brand, last4, exp_month, exp_year },
 *   invoices: [{ id, amount_paid, currency, paid_at (unix) }] (paid ones) }.
 * The organization is the one that owns the customer (saved by the server first).
 */
create or replace function public.billing_autopay_sync(p_key text, p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text := coalesce(p_state ->> 'provider', 'square');
  v_sub text := p_state ->> 'subscription_id';
  v_cus text := p_state ->> 'customer_id';
  v_status text := p_state ->> 'status';
  v_plan text := p_state ->> 'plan_key';
  v_card jsonb := p_state -> 'card';
  v_existing private.billing_subscriptions;
  v_org uuid;
  v_inv jsonb;
  v_charge public.billing_charges;
  v_plan_row public.plans;
  v_paid integer := 0;
begin
  perform private.assert_billing_key(p_key);
  if p_state is null or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 8192
     or v_provider not in ('square', 'stripe')
     or v_sub is null or v_sub !~ '^[A-Za-z0-9_-]{6,64}$'
     or v_cus is null or v_cus !~ '^[A-Za-z0-9_-]{6,64}$'
     or v_status is null or v_status not in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  -- The organization that owns this customer (never one named by the payload alone).
  select * into v_existing from private.billing_subscriptions
  where provider = v_provider and customer_id = v_cus for update;
  if v_existing.organization_id is null then
    return jsonb_build_object('status', 'unknown_customer');
  end if;
  v_org := v_existing.organization_id;
  if p_state ? 'organization_id' and private.safe_uuid(p_state ->> 'organization_id') is distinct from v_org then
    perform private.hq_log('billing.autopay_customer_mismatch', 'organization', v_org::text,
      jsonb_build_object('customer', v_cus, 'subscription', v_sub));
    return jsonb_build_object('status', 'customer_mismatch');
  end if;
  -- An older subscription of the same customer does not overwrite the current one.
  if v_existing.subscription_id is not null and v_existing.subscription_id <> v_sub
     and v_existing.status not in ('canceled', 'incomplete_expired') and v_status in ('canceled', 'incomplete_expired') then
    return jsonb_build_object('status', 'stale');
  end if;
  if v_plan is not null and not exists (select 1 from public.plans where key = v_plan) then
    v_plan := null;
  end if;

  update private.billing_subscriptions b set
    subscription_id = v_sub,
    card_id = coalesce(nullif(p_state ->> 'card_id', ''), b.card_id),
    plan_key = coalesce(v_plan, b.plan_key),
    status = v_status,
    cancel_at_period_end = coalesce((p_state ->> 'cancel_at_period_end')::boolean, false),
    current_period_end = coalesce(case when jsonb_typeof(p_state -> 'current_period_end') = 'number'
      then to_timestamp((p_state ->> 'current_period_end')::bigint) end, b.current_period_end),
    amount = coalesce(case when jsonb_typeof(p_state -> 'amount') = 'number' then (p_state ->> 'amount')::numeric::integer end, b.amount),
    currency = coalesce(lower(nullif(p_state ->> 'currency', '')), b.currency),
    card_brand = case when v_card ->> 'last4' ~ '^[0-9]{4}$' then lower(regexp_replace(left(v_card ->> 'brand', 20), '[^a-zA-Z_]', '', 'g')) else b.card_brand end,
    card_last4 = case when v_card ->> 'last4' ~ '^[0-9]{4}$' then v_card ->> 'last4' else b.card_last4 end,
    card_exp_month = case when jsonb_typeof(v_card -> 'exp_month') = 'number' then (v_card ->> 'exp_month')::smallint else b.card_exp_month end,
    card_exp_year = case when jsonb_typeof(v_card -> 'exp_year') = 'number' then (v_card ->> 'exp_year')::smallint else b.card_exp_year end,
    livemode = coalesce((p_state ->> 'livemode')::boolean, b.livemode),
    updated_at = now()
  where b.organization_id = v_org;

  -- Paid invoices: each one becomes a paid charge, once (receipt, plan, next due date).
  for v_inv in select value from jsonb_array_elements(case when jsonb_typeof(p_state -> 'invoices') = 'array' then p_state -> 'invoices' else '[]'::jsonb end) limit 24
  loop
    continue when v_inv ->> 'id' !~ '^[A-Za-z0-9_-]{6,64}$' or jsonb_typeof(v_inv -> 'amount_paid') <> 'number' or (v_inv ->> 'amount_paid')::numeric <= 0;
    continue when exists (select 1 from public.billing_charges where payment_provider = v_provider and payment_reference = v_inv ->> 'id');
    select * into v_plan_row from public.plans where key = coalesce(v_plan, v_existing.plan_key);
    insert into public.billing_charges (organization_id, label, description, kind, base_amount, discount_amount, currency, due_date, plan_key)
    values (v_org, left('Plan ' || coalesce(v_plan_row.name, 'LevelUp'), 120), 'Monthly plan (automatic payment)', 'subscription',
      (v_inv ->> 'amount_paid')::numeric::integer, 0, lower(coalesce(nullif(v_inv ->> 'currency', ''), v_plan_row.currency, 'usd')), current_date, v_plan_row.key)
    returning * into v_charge;
    update public.billing_charges set
      status = 'paid',
      paid_at = case when jsonb_typeof(v_inv -> 'paid_at') = 'number' then to_timestamp((v_inv ->> 'paid_at')::bigint) else now() end,
      payment_method = 'card', payment_provider = v_provider, payment_reference = v_inv ->> 'id',
      paid_amount = (v_inv ->> 'amount_paid')::numeric::integer
    where id = v_charge.id;
    update public.billing_charges set status = 'void', void_reason = 'Paid by automatic payment'
    where organization_id = v_org and status in ('due', 'overdue') and kind = 'subscription'
      and id <> v_charge.id and provider_session_id is null;
    v_paid := v_paid + 1;
    perform private.hq_log('billing.autopay_paid', 'organization', v_org::text,
      jsonb_build_object('charge_id', v_charge.id, 'invoice', v_inv ->> 'id', 'amount', v_inv -> 'amount_paid', 'plan', v_plan_row.key, 'provider', v_provider));
  end loop;

  if v_status in ('past_due', 'unpaid') and coalesce(v_existing.status, '') not in ('past_due', 'unpaid') then
    perform private.hq_log('billing.autopay_failed', 'organization', v_org::text, jsonb_build_object('subscription', v_sub, 'status', v_status));
  end if;
  return jsonb_build_object('status', 'synced', 'invoices_paid', v_paid);
end;
$$;

revoke all on function public.billing_autopay_customer(text, uuid, text, text, boolean),
  public.billing_autopay_plan_put(text, text, integer, text, text, boolean) from public;
grant execute on function public.billing_autopay_customer(text, uuid, text, text, boolean),
  public.billing_autopay_plan_put(text, text, integer, text, text, boolean) to anon, authenticated;
