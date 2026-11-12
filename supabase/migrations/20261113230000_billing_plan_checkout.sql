-- Paying for a plan online. "Choose this plan" in Billing no longer only asks
-- LevelUp when the plan has a price: an owner or admin gets a charge for the
-- first month of that plan (billing_plan_charge), pays it on the usual secure
-- payment page, and the organization moves to the plan as soon as the payment
-- is recorded (trigger on billing_charges). Plans without a price, and the
-- free plan, keep the request flow (request_plan_upgrade).

alter table public.billing_charges
  add column if not exists plan_key text references public.plans (key);

comment on column public.billing_charges.plan_key is
  'The plan this charge pays for: when it is paid, the organization moves to this plan.';

-- @part 1: the charge for a plan ---------------------------------------------
create or replace function public.billing_plan_charge(p_org uuid, p_plan_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_row public.billing_charges;
  v_disc_id uuid;
  v_disc_label text;
  v_disc_amount integer := 0;
begin
  if auth.uid() is null or p_org is null or not private.has_org_role(p_org, 'admin') then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  select * into v_plan from public.plans where key = p_plan_key and active;
  if not found then
    raise exception 'plan_not_found' using errcode = 'PT404';
  end if;
  if private.org_plan_key(p_org) = v_plan.key then
    raise exception 'already_on_plan' using errcode = 'PT409';
  end if;
  if v_plan.price_monthly is null or v_plan.price_monthly <= 0 then
    raise exception 'price_not_set' using errcode = 'PT409';
  end if;

  -- The same choice again: the charge already waiting for payment.
  select * into v_row from public.billing_charges
  where organization_id = p_org and plan_key = v_plan.key and status = 'due'
  order by created_at desc limit 1 for update;
  if found then
    return jsonb_build_object('charge_id', v_row.id, 'amount', v_row.amount,
      'currency', v_row.currency, 'already', true);
  end if;

  perform private.hit_rate_limit('billing_plan_charge', p_org::text, 10, interval '1 day');

  -- Another plan chosen before: its unpaid charge is withdrawn.
  update public.billing_charges
  set status = 'void', void_reason = 'Another plan was chosen'
  where organization_id = p_org and plan_key is not null and plan_key <> v_plan.key
    and status = 'due' and provider_session_id is null;

  select b.discount_id, b.label, b.amount into v_disc_id, v_disc_label, v_disc_amount
  from private.best_discount(p_org, 'subscription', v_plan.currency, v_plan.price_monthly) b;

  insert into public.billing_charges
    (organization_id, label, description, kind, base_amount, discount_id, discount_label,
     discount_amount, currency, due_date, created_by, plan_key)
  values (p_org, left('Plan ' || v_plan.name, 120), 'First month', 'subscription',
     v_plan.price_monthly, v_disc_id, v_disc_label, coalesce(v_disc_amount, 0),
     v_plan.currency, current_date, auth.uid(), v_plan.key)
  returning * into v_row;

  if v_disc_id is not null then
    update public.discounts set uses = uses + 1
    where id = v_disc_id and code is null and max_uses is not null;
  end if;

  perform private.hq_log('billing.plan_charge_created', 'organization', p_org::text,
    jsonb_build_object('charge_id', v_row.id, 'plan', v_plan.key, 'amount', v_row.amount,
      'currency', v_row.currency));
  return jsonb_build_object('charge_id', v_row.id, 'amount', v_row.amount,
    'currency', v_row.currency, 'already', false);
end;
$$;

revoke all on function public.billing_plan_charge(uuid, text) from public, anon;
grant execute on function public.billing_plan_charge(uuid, text) to authenticated;

-- @part 2: paid -> the organization moves to the plan --------------------------
create or replace function private.billing_plan_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_billing
    (organization_id, plan_key, status, custom_price, next_due_date)
  values (new.organization_id, new.plan_key, 'active', null,
    (coalesce(new.paid_at, now())::date + interval '1 month')::date)
  on conflict (organization_id) do update set
    plan_key = excluded.plan_key, status = 'active', custom_price = null,
    next_due_date = excluded.next_due_date, updated_at = now();

  update public.plan_upgrade_requests
  set status = 'approved', decided_at = now(), decision_note = 'Paid online'
  where organization_id = new.organization_id and status = 'pending';

  perform private.hq_log('billing.plan_paid', 'organization', new.organization_id::text,
    jsonb_build_object('charge_id', new.id, 'plan', new.plan_key, 'amount', new.amount,
      'currency', new.currency));
  return null;
end;
$$;

revoke all on function private.billing_plan_paid() from public, anon, authenticated;

drop trigger if exists billing_charges_plan_paid on public.billing_charges;
create trigger billing_charges_plan_paid
  after update of status on public.billing_charges
  for each row
  when (new.status = 'paid' and old.status is distinct from 'paid' and new.plan_key is not null)
  execute function private.billing_plan_paid();
