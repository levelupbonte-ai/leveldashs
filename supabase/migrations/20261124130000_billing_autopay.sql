-- Automatic monthly payment of the LevelUp plan (Stripe subscriptions).
--
-- The client's owner or admin turns it on from Billing: Stripe keeps the card,
-- charges each month and LevelUp records every paid invoice as a paid charge
-- (receipt, plan, next due date: the existing billing_plan_paid trigger). The
-- card itself never reaches LevelUp: only its brand, last 4 digits and expiry.
-- Writes come from the server with the billing key (webhook), reads from the
-- organization's owners and admins.

create table if not exists private.billing_subscriptions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  provider text not null default 'stripe' check (provider = 'stripe'),
  customer_id text not null check (customer_id ~ '^cus_[A-Za-z0-9]{6,64}$'),
  subscription_id text unique check (subscription_id is null or subscription_id ~ '^sub_[A-Za-z0-9]{6,64}$'),
  plan_key text references public.plans (key),
  status text not null default 'none'
    check (status in ('none', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  amount integer,
  currency text check (currency is null or currency ~ '^[a-z]{3}$'),
  card_brand text check (card_brand is null or card_brand ~ '^[a-z_]{2,20}$'),
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  card_exp_month smallint check (card_exp_month is null or card_exp_month between 1 and 12),
  card_exp_year smallint check (card_exp_year is null or card_exp_year between 2000 and 2100),
  livemode boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table private.billing_subscriptions enable row level security;
revoke all on private.billing_subscriptions from public, anon, authenticated;

-- ------------------------------------------------------------------ read (owners and admins)
create or replace function public.billing_autopay(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s private.billing_subscriptions;
begin
  if auth.uid() is null or p_org is null or not private.has_org_role(p_org, 'admin') then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  select * into s from private.billing_subscriptions where organization_id = p_org;
  if s.organization_id is null or s.subscription_id is null then
    return jsonb_build_object('on', false);
  end if;
  return jsonb_build_object(
    'on', s.status in ('trialing', 'active', 'past_due', 'unpaid', 'incomplete'),
    'status', s.status,
    'plan_key', s.plan_key,
    'plan_name', (select p.name from public.plans p where p.key = s.plan_key),
    'amount', s.amount,
    'currency', s.currency,
    'cancel_at_period_end', s.cancel_at_period_end,
    'current_period_end', s.current_period_end,
    'card', case when s.card_last4 is not null then jsonb_build_object(
      'brand', s.card_brand, 'last4', s.card_last4, 'exp_month', s.card_exp_month, 'exp_year', s.card_exp_year) end,
    'updated_at', s.updated_at);
end;
$$;

-- What the server needs to open Stripe for this organization (owners and admins only).
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
    'customer_id', s.customer_id,
    'subscription_id', s.subscription_id,
    'status', coalesce(s.status, 'none'),
    'current_plan', private.org_plan_key(p_org),
    'plan', case when v_plan.key is not null then jsonb_build_object(
      'key', v_plan.key, 'name', v_plan.name, 'amount', v_plan.price_monthly, 'currency', lower(v_plan.currency)) end);
end;
$$;

-- ------------------------------------------------------------------ write (server, billing key)
-- The Stripe customer created for an organization (before its first checkout).
create or replace function public.billing_autopay_customer(p_key text, p_org uuid, p_customer text, p_live boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_billing_key(p_key);
  if p_org is null or p_customer is null or p_customer !~ '^cus_[A-Za-z0-9]{6,64}$' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  insert into private.billing_subscriptions (organization_id, customer_id, livemode)
  values (p_org, p_customer, coalesce(p_live, false))
  on conflict (organization_id) do update set customer_id = excluded.customer_id, updated_at = now()
  where private.billing_subscriptions.subscription_id is null;
  return jsonb_build_object('ok', true);
end;
$$;

/*
 * The state of a Stripe subscription (from the webhook, read back from Stripe):
 * { organization_id, customer_id, subscription_id, status, plan_key, amount,
 *   currency, cancel_at_period_end, current_period_end (unix), livemode,
 *   card: { brand, last4, exp_month, exp_year } }
 * and, for a paid invoice, invoice: { id, amount_paid, currency, paid_at (unix) }.
 */
create or replace function public.billing_autopay_sync(p_key text, p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.safe_uuid(p_state ->> 'organization_id');
  v_sub text := p_state ->> 'subscription_id';
  v_cus text := p_state ->> 'customer_id';
  v_status text := p_state ->> 'status';
  v_plan text := p_state ->> 'plan_key';
  v_card jsonb := p_state -> 'card';
  v_inv jsonb := p_state -> 'invoice';
  v_existing private.billing_subscriptions;
  v_charge public.billing_charges;
  v_plan_row public.plans;
  v_out text := 'synced';
begin
  perform private.assert_billing_key(p_key);
  if p_state is null or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 4096
     or v_org is null or v_sub is null or v_sub !~ '^sub_[A-Za-z0-9]{6,64}$'
     or v_cus is null or v_cus !~ '^cus_[A-Za-z0-9]{6,64}$'
     or v_status is null or v_status not in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = v_org) then
    return jsonb_build_object('status', 'unknown_organization');
  end if;
  select * into v_existing from private.billing_subscriptions where organization_id = v_org for update;
  -- Only the organization's own customer (the server created it and saved it first).
  if v_existing.organization_id is not null and v_existing.customer_id <> v_cus then
    perform private.hq_log('billing.autopay_customer_mismatch', 'organization', v_org::text,
      jsonb_build_object('customer', v_cus, 'subscription', v_sub));
    return jsonb_build_object('status', 'customer_mismatch');
  end if;
  if v_plan is not null and not exists (select 1 from public.plans where key = v_plan) then
    v_plan := null;
  end if;

  insert into private.billing_subscriptions as b (organization_id, customer_id, subscription_id, plan_key, status,
    cancel_at_period_end, current_period_end, amount, currency, card_brand, card_last4, card_exp_month, card_exp_year, livemode, updated_at)
  values (v_org, v_cus, v_sub, v_plan, v_status,
    coalesce((p_state ->> 'cancel_at_period_end')::boolean, false),
    case when jsonb_typeof(p_state -> 'current_period_end') = 'number' then to_timestamp((p_state ->> 'current_period_end')::bigint) end,
    case when jsonb_typeof(p_state -> 'amount') = 'number' then (p_state ->> 'amount')::numeric::integer end,
    lower(nullif(p_state ->> 'currency', '')),
    case when v_card ->> 'last4' ~ '^[0-9]{4}$' then lower(left(v_card ->> 'brand', 20)) end,
    case when v_card ->> 'last4' ~ '^[0-9]{4}$' then v_card ->> 'last4' end,
    case when jsonb_typeof(v_card -> 'exp_month') = 'number' then (v_card ->> 'exp_month')::smallint end,
    case when jsonb_typeof(v_card -> 'exp_year') = 'number' then (v_card ->> 'exp_year')::smallint end,
    coalesce((p_state ->> 'livemode')::boolean, false), now())
  on conflict (organization_id) do update set
    subscription_id = excluded.subscription_id,
    plan_key = coalesce(excluded.plan_key, b.plan_key),
    status = excluded.status,
    cancel_at_period_end = excluded.cancel_at_period_end,
    current_period_end = coalesce(excluded.current_period_end, b.current_period_end),
    amount = coalesce(excluded.amount, b.amount),
    currency = coalesce(excluded.currency, b.currency),
    card_brand = coalesce(excluded.card_brand, b.card_brand),
    card_last4 = coalesce(excluded.card_last4, b.card_last4),
    card_exp_month = coalesce(excluded.card_exp_month, b.card_exp_month),
    card_exp_year = coalesce(excluded.card_exp_year, b.card_exp_year),
    livemode = excluded.livemode,
    updated_at = now();

  -- A paid invoice: the month is paid (receipt, plan and next due date).
  if v_inv is not null and jsonb_typeof(v_inv) = 'object' and v_inv ->> 'id' ~ '^in_[A-Za-z0-9]{6,64}$'
     and jsonb_typeof(v_inv -> 'amount_paid') = 'number' and (v_inv ->> 'amount_paid')::numeric > 0 then
    if exists (select 1 from public.billing_charges where payment_provider = 'stripe' and payment_reference = v_inv ->> 'id') then
      v_out := 'duplicate_invoice';
    else
      select * into v_plan_row from public.plans where key = coalesce(v_plan, v_existing.plan_key);
      insert into public.billing_charges (organization_id, label, description, kind, base_amount, discount_amount,
        currency, due_date, plan_key)
      values (v_org, left('Plan ' || coalesce(v_plan_row.name, 'LevelUp'), 120), 'Monthly plan (automatic payment)',
        'subscription', (v_inv ->> 'amount_paid')::numeric::integer, 0,
        lower(coalesce(nullif(v_inv ->> 'currency', ''), v_plan_row.currency, 'usd')), current_date, v_plan_row.key)
      returning * into v_charge;
      update public.billing_charges set
        status = 'paid',
        paid_at = case when jsonb_typeof(v_inv -> 'paid_at') = 'number' then to_timestamp((v_inv ->> 'paid_at')::bigint) else now() end,
        payment_method = 'card', payment_provider = 'stripe', payment_reference = v_inv ->> 'id',
        paid_amount = (v_inv ->> 'amount_paid')::numeric::integer
      where id = v_charge.id;
      -- The month is paid: other charges for this plan waiting for payment are withdrawn.
      update public.billing_charges set status = 'void', void_reason = 'Paid by automatic payment'
      where organization_id = v_org and status in ('due', 'overdue') and kind = 'subscription'
        and id <> v_charge.id and provider_session_id is null;
      v_out := 'invoice_paid';
      perform private.hq_log('billing.autopay_paid', 'organization', v_org::text,
        jsonb_build_object('charge_id', v_charge.id, 'invoice', v_inv ->> 'id', 'amount', v_inv -> 'amount_paid', 'plan', v_plan_row.key));
    end if;
  end if;

  if v_status in ('past_due', 'unpaid') and coalesce(v_existing.status, '') not in ('past_due', 'unpaid') then
    perform private.hq_log('billing.autopay_failed', 'organization', v_org::text, jsonb_build_object('subscription', v_sub, 'status', v_status));
  end if;
  return jsonb_build_object('status', v_out);
end;
$$;

revoke all on function public.billing_autopay(uuid), public.billing_autopay_prepare(uuid, text),
  public.billing_autopay_customer(text, uuid, text, boolean), public.billing_autopay_sync(text, jsonb) from public, anon;
grant execute on function public.billing_autopay(uuid), public.billing_autopay_prepare(uuid, text) to authenticated;
grant execute on function public.billing_autopay_customer(text, uuid, text, boolean), public.billing_autopay_sync(text, jsonb) to anon, authenticated;
