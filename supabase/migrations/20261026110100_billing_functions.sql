-- Billing functions (tables in 20261026110000_billing_schema.sql).
--
-- Helpers (private, not exposed):
--   private.org_plan_key(org), private.plan_limit(org, key), private.org_usage(org, key),
--   private.assert_within_limit(org, key, current, adding = 1): raises
--   `plan_limit_reached` (errcode PT402, detail = {"key", "limit", "plan"} as JSON).
--   private.effective_price(org), private.best_discount(org, kind, currency, base).
-- Clients (members of the organization):
--   billing_summary(org): plan, limits, usage, plan catalog for everyone; prices,
--     discounts, charges and total due only for owners and admins.
--   redeem_discount_code(org, code), request_plan_upgrade(org, plan, message):
--     owners and admins, rate limited.
-- LevelUp staff (private.assert_platform_admin: platform admin, aal2 session),
-- every change audited in public.hq_audit_log (`billing.*`):
--   admin_list_billing_orgs, admin_get_org_billing, admin_set_org_billing,
--   admin_create_charge, admin_update_charge, admin_void_charge, admin_mark_charge_paid,
--   admin_save_discount, admin_set_discount_active, admin_save_plan,
--   admin_list_upgrade_requests, admin_decide_upgrade_request.
-- Error messages are short codes mapped to AppError codes by the dashboard
-- (src/features/billing/lib/errors.ts).

-- @part 1: plan, limits and usage ----------------------------------------------

create or replace function private.billing_limit_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['team_members', 'assistant_requests_month', 'media_mb', 'websites'];
$$;

-- Known keys only, each null (unlimited) or a whole number 0..10 000 000.
create or replace function private.clean_plan_limits(p_limits jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := '{}'::jsonb;
  r record;
  n numeric;
begin
  if p_limits is null or jsonb_typeof(p_limits) <> 'object' then
    raise exception 'invalid_limits' using errcode = '22023';
  end if;
  for r in select key, value from jsonb_each(p_limits) loop
    if not r.key = any (private.billing_limit_keys()) then
      raise exception 'invalid_limits' using errcode = '22023';
    end if;
    if jsonb_typeof(r.value) = 'null' then
      v_out := v_out || jsonb_build_object(r.key, null);
      continue;
    end if;
    if jsonb_typeof(r.value) <> 'number' then
      raise exception 'invalid_limits' using errcode = '22023';
    end if;
    n := (r.value #>> '{}')::numeric;
    if n <> trunc(n) or n < 0 or n > 10000000 then
      raise exception 'invalid_limits' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object(r.key, n::integer);
  end loop;
  return v_out;
end;
$$;

create or replace function private.org_plan_key(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select b.plan_key from public.organization_billing b where b.organization_id = p_org),
    (select p.key from public.plans p where p.is_default limit 1)
  );
$$;

-- The limit of the organization's plan; null = unlimited (or not limited).
create or replace function private.plan_limit(p_org uuid, p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (p.limits ->> p_key)::integer
  from public.plans p
  where p.key = private.org_plan_key(p_org);
$$;

-- Seats: members plus live invitations, except one e-mail (a re-sent
-- invitation to the same address does not take a second seat).
create or replace function private.team_seats_used(p_org uuid, p_except_email text default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (select count(*) from public.organization_members m where m.organization_id = p_org)
    + (select count(*) from public.organization_invitations i
       where i.organization_id = p_org and i.accepted_at is null and i.revoked_at is null
         and i.expires_at > now()
         and (p_except_email is null or i.email <> lower(btrim(p_except_email))))
  )::integer;
$$;

create or replace function private.org_usage(p_org uuid, p_key text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case p_key
    when 'team_members' then private.team_seats_used(p_org)::numeric
    when 'assistant_requests_month' then (
      select coalesce(sum(u.count), 0)::numeric from public.ai_usage u
      where u.organization_id = p_org and u.feature = 'assistant'
        and u.day >= date_trunc('month', now() at time zone 'utc')::date)
    when 'media_mb' then (
      select round(coalesce(sum(m.size_bytes), 0) / 1048576.0, 1) from public.media m
      where m.organization_id = p_org)
    when 'websites' then (
      select count(*)::numeric from public.websites w
      where w.organization_id = p_org and w.status <> 'archived')
  end;
$$;

-- Raises plan_limit_reached when current + adding goes past the plan's limit.
create or replace function private.assert_within_limit(
  p_org uuid,
  p_key text,
  p_current numeric,
  p_adding numeric default 1
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := private.plan_limit(p_org, p_key);
begin
  if v_limit is not null and coalesce(p_current, 0) + coalesce(p_adding, 1) > v_limit then
    raise exception 'plan_limit_reached' using errcode = 'PT402',
      detail = jsonb_build_object('key', p_key, 'limit', v_limit, 'plan', private.org_plan_key(p_org))::text,
      hint = p_key;
  end if;
end;
$$;

-- @part 2: prices and discounts ------------------------------------------------

-- Monthly price of the organization: its custom price, else its plan's price.
-- state: custom | free | set | unset (null price: "to be set by LevelUp").
create or replace function private.effective_price(p_org uuid)
returns table (price integer, currency text, state text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(b.custom_price, p.price_monthly),
    case when b.custom_price is not null then b.currency else p.currency end,
    case
      when b.custom_price is not null then 'custom'
      when p.price_monthly is null then 'unset'
      when p.price_monthly = 0 then 'free'
      else 'set'
    end
  from public.plans p
  left join public.organization_billing b on b.organization_id = p_org
  where p.key = private.org_plan_key(p_org);
$$;

create or replace function private.discount_off(p_kind text, p_value integer, p_base integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  -- Percent: rounded half up to the cent. Fixed: never more than the base.
  select case
    when p_base is null or p_base <= 0 then 0
    when p_kind = 'percent' then least(p_base, round(p_base::numeric * p_value / 100)::integer)
    else least(p_base, p_value)
  end;
$$;

-- Discounts the organization has right now: its own (no code, uses left) and the
-- codes it redeemed; active and inside their dates.
create or replace function private.org_discount_ids(p_org uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from public.discounts d
  where d.active
    and (d.starts_at is null or d.starts_at <= now())
    and (d.ends_at is null or d.ends_at > now())
    and (
      (d.code is null and d.organization_id = p_org and (d.max_uses is null or d.uses < d.max_uses))
      or exists (select 1 from public.discount_redemptions r where r.discount_id = d.id and r.organization_id = p_org)
    );
$$;

-- The single best discount for a charge (discounts never stack).
create or replace function private.best_discount(p_org uuid, p_kind text, p_currency text, p_base integer)
returns table (discount_id uuid, label text, amount integer)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.label, private.discount_off(d.kind, d.value, p_base)
  from public.discounts d
  where d.id in (select private.org_discount_ids(p_org))
    and (d.applies_to = 'all' or d.applies_to = p_kind)
    and (d.kind = 'percent' or d.currency = p_currency)
    and private.discount_off(d.kind, d.value, p_base) > 0
  order by 3 desc, d.created_at
  limit 1;
$$;

create or replace function private.charge_json(c public.billing_charges)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'label', c.label, 'description', c.description, 'kind', c.kind,
    'base_amount', c.base_amount, 'discount_label', c.discount_label,
    'discount_amount', c.discount_amount, 'amount', c.amount, 'currency', c.currency,
    'due_date', c.due_date,
    'status', case when c.status = 'due' and c.due_date < (now() at time zone 'America/Toronto')::date
                   then 'overdue' else c.status end,
    'paid_at', c.paid_at, 'payment_note', c.payment_note, 'created_at', c.created_at);
$$;

create or replace function private.discount_json(d public.discounts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', d.id, 'label', d.label, 'kind', d.kind, 'value', d.value,
    'currency', d.currency, 'applies_to', d.applies_to, 'ends_at', d.ends_at,
    'code', d.code is not null);
$$;

-- @part 3: client reads ---------------------------------------------------------

create or replace function public.billing_summary(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_money boolean;
  v_plan public.plans;
  v_bill public.organization_billing;
  v_price record;
  v_disc record;
  v_usage jsonb := '[]'::jsonb;
  v_key text;
  v_out jsonb;
begin
  if auth.uid() is null or p_org is null or not private.has_org_role(p_org, 'viewer') then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  v_money := private.has_org_role(p_org, 'admin');
  select * into v_plan from public.plans where key = private.org_plan_key(p_org);
  select * into v_bill from public.organization_billing where organization_id = p_org;

  foreach v_key in array private.billing_limit_keys() loop
    if v_plan.limits ? v_key then
      v_usage := v_usage || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'used', private.org_usage(p_org, v_key), 'limit', v_plan.limits -> v_key));
    end if;
  end loop;

  v_out := jsonb_build_object(
    'can_manage', v_money,
    'status', coalesce(v_bill.status, 'active'),
    'plan', jsonb_build_object('key', v_plan.key, 'name', v_plan.name, 'description', v_plan.description,
      'features', to_jsonb(v_plan.features), 'limits', v_plan.limits),
    'usage', v_usage,
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object('key', p.key, 'name', p.name, 'description', p.description,
        'features', to_jsonb(p.features), 'limits', p.limits,
        'price', case when v_money then p.price_monthly end,
        'currency', case when v_money then p.currency end,
        'price_state', case when not v_money then null when p.price_monthly is null then 'unset'
                            when p.price_monthly = 0 then 'free' else 'set' end)
        order by p.sort_order, p.key)
      from public.plans p where p.active or p.key = v_plan.key), '[]'::jsonb),
    'pending_request', (
      select jsonb_build_object('id', r.id, 'plan_key', r.plan_key, 'created_at', r.created_at)
      from public.plan_upgrade_requests r where r.organization_id = p_org and r.status = 'pending'),
    'money', null);

  if not v_money then
    return v_out;
  end if;

  select * into v_price from private.effective_price(p_org);
  select * into v_disc from private.best_discount(p_org, 'subscription', v_price.currency, v_price.price);
  return v_out || jsonb_build_object('money', jsonb_build_object(
    'price', v_price.price,
    'currency', v_price.currency,
    'price_state', v_price.state,
    'price_after_discount', case when v_price.price is not null then v_price.price - coalesce(v_disc.amount, 0) end,
    'subscription_discount', case when v_disc.discount_id is not null
      then jsonb_build_object('label', v_disc.label, 'amount', v_disc.amount) end,
    'next_due_date', v_bill.next_due_date,
    'note', v_bill.billing_note,
    'discounts', coalesce((
      select jsonb_agg(private.discount_json(d) order by d.created_at)
      from public.discounts d where d.id in (select private.org_discount_ids(p_org))), '[]'::jsonb),
    'charges', coalesce((
      select jsonb_agg(private.charge_json(c) order by c.created_at desc)
      from public.billing_charges c
      where c.id in (select x.id from public.billing_charges x where x.organization_id = p_org
                     order by x.created_at desc limit 200)), '[]'::jsonb),
    'total_due', coalesce((
      select jsonb_agg(jsonb_build_object('currency', t.currency, 'amount', t.amount) order by t.currency)
      from (select currency, sum(amount)::bigint as amount from public.billing_charges
            where organization_id = p_org and status = 'due' group by currency) t), '[]'::jsonb),
    'overdue_count', (select count(*) from public.billing_charges
      where organization_id = p_org and status = 'due'
        and due_date < (now() at time zone 'America/Toronto')::date)
  ));
end;
$$;

-- @part 4: client writes --------------------------------------------------------

-- Owners and admins redeem a promo code. Answers a status instead of raising, so
-- the rate limit counts failed attempts too: `redeemed` (with the discount),
-- `already_redeemed`, or `invalid` for unknown, inactive, expired, used up or
-- bound to another organization (nothing to probe).
create or replace function public.redeem_discount_code(p_org uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_d public.discounts;
begin
  if auth.uid() is null or p_org is null or not private.has_org_role(p_org, 'admin') then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  perform private.hit_rate_limit('discount_redeem_org', p_org::text, 5, interval '1 hour');
  perform private.hit_rate_limit('discount_redeem_user', auth.uid()::text, 10, interval '1 hour');
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{2,31}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_d from public.discounts d where d.code = v_code for update;
  if not found or not v_d.active
     or (v_d.starts_at is not null and v_d.starts_at > now())
     or (v_d.ends_at is not null and v_d.ends_at <= now())
     or (v_d.organization_id is not null and v_d.organization_id <> p_org) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from public.discount_redemptions r where r.discount_id = v_d.id and r.organization_id = p_org) then
    return jsonb_build_object('status', 'already_redeemed');
  end if;
  if v_d.max_uses is not null and v_d.uses >= v_d.max_uses then
    return jsonb_build_object('status', 'invalid');
  end if;

  insert into public.discount_redemptions (discount_id, organization_id, redeemed_by)
  values (v_d.id, p_org, auth.uid());
  update public.discounts set uses = uses + 1 where id = v_d.id;
  perform private.hq_log('billing.code_redeemed', 'organization', p_org::text,
    jsonb_build_object('discount_id', v_d.id, 'label', v_d.label));
  return jsonb_build_object('status', 'redeemed', 'discount', private.discount_json(v_d));
end;
$$;

-- Owners and admins ask LevelUp for another plan (not a payment). One pending
-- request per organization: asking again replaces the plan asked for.
create or replace function public.request_plan_upgrade(p_org uuid, p_plan_key text, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_current text;
  v_message text;
  v_id uuid;
  v_prev text;
begin
  if auth.uid() is null or p_org is null or not private.has_org_role(p_org, 'admin') then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  select * into v_plan from public.plans where key = p_plan_key and active;
  if not found then
    raise exception 'plan_not_found' using errcode = 'PT404';
  end if;
  v_current := private.org_plan_key(p_org);
  if v_current = v_plan.key then
    raise exception 'already_on_plan' using errcode = 'PT409';
  end if;
  v_message := private.check_text(p_message, 1000, 'message', true);

  select id, plan_key into v_id, v_prev from public.plan_upgrade_requests
  where organization_id = p_org and status = 'pending' for update;
  if v_id is not null and v_prev = v_plan.key then
    return jsonb_build_object('id', v_id, 'already', true);
  end if;
  perform private.hit_rate_limit('plan_upgrade_request', p_org::text, 5, interval '1 day');

  if v_id is null then
    insert into public.plan_upgrade_requests (organization_id, plan_key, from_plan_key, message, requested_by)
    values (p_org, v_plan.key, v_current, v_message, auth.uid())
    returning id into v_id;
  else
    update public.plan_upgrade_requests
    set plan_key = v_plan.key, message = coalesce(v_message, message), requested_by = auth.uid(), created_at = now()
    where id = v_id;
  end if;
  perform private.hq_log('billing.upgrade_requested', 'organization', p_org::text,
    jsonb_build_object('request_id', v_id, 'plan', v_plan.key, 'from_plan', v_current));
  return jsonb_build_object('id', v_id, 'already', false,
    'organization_name', (select name from public.organizations where id = p_org),
    'plan_name', v_plan.name,
    'from_plan_name', (select name from public.plans where key = v_current),
    'message', v_message);
end;
$$;

-- @part 5: staff ------------------------------------------------------------------

create or replace function private.assert_billing_org(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null or not exists (select 1 from public.organizations o where o.id = p_org and o.status <> 'archived') then
    raise exception 'organization_not_found' using errcode = 'PT404';
  end if;
end;
$$;

create or replace function private.clean_currency(p_currency text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_currency, '')));
begin
  if v !~ '^[a-z]{3}$' then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function private.check_amount(p_amount integer, p_allow_zero boolean default false)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null or p_amount > 100000000 or p_amount < 0 or (p_amount = 0 and not p_allow_zero) then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  return p_amount;
end;
$$;

-- Every organization with its plan, price state, amount due and pending request.
create or replace function public.admin_list_billing_orgs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'organization_id', o.id, 'organization_name', o.name,
      'plan_key', pk.key, 'plan_name', p.name,
      'status', coalesce(b.status, 'active'),
      'price', ep.price, 'currency', ep.currency, 'price_state', ep.state,
      'next_due_date', b.next_due_date,
      'total_due', coalesce((
        select jsonb_agg(jsonb_build_object('currency', t.currency, 'amount', t.amount) order by t.currency)
        from (select currency, sum(amount)::bigint as amount from public.billing_charges c
              where c.organization_id = o.id and c.status = 'due' group by currency) t), '[]'::jsonb),
      'overdue_count', (select count(*) from public.billing_charges c where c.organization_id = o.id
        and c.status = 'due' and c.due_date < (now() at time zone 'America/Toronto')::date),
      'discount_count', (select count(*) from private.org_discount_ids(o.id)),
      'pending_plan_key', (select r.plan_key from public.plan_upgrade_requests r
        where r.organization_id = o.id and r.status = 'pending'),
      'pending_plan_name', (select rp.name from public.plan_upgrade_requests r
        join public.plans rp on rp.key = r.plan_key
        where r.organization_id = o.id and r.status = 'pending'))
      order by o.name)
    from public.organizations o
    left join public.organization_billing b on b.organization_id = o.id
    cross join lateral (select private.org_plan_key(o.id) as key) pk
    join public.plans p on p.key = pk.key
    cross join lateral private.effective_price(o.id) ep
    where o.status <> 'archived'), '[]'::jsonb);
end;
$$;

-- One organization: the client summary plus the staff fields.
create or replace function public.admin_get_org_billing(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bill public.organization_billing;
begin
  perform private.assert_platform_admin();
  perform private.assert_billing_org(p_org);
  select * into v_bill from public.organization_billing where organization_id = p_org;
  return public.billing_summary(p_org) || jsonb_build_object(
    'organization', (select jsonb_build_object('id', o.id, 'name', o.name) from public.organizations o where o.id = p_org),
    'billing', jsonb_build_object(
      'plan_key', private.org_plan_key(p_org),
      'status', coalesce(v_bill.status, 'active'),
      'custom_price', v_bill.custom_price,
      'currency', coalesce(v_bill.currency, (select p.currency from public.plans p where p.key = private.org_plan_key(p_org))),
      'billing_note', v_bill.billing_note,
      'next_due_date', v_bill.next_due_date,
      'updated_at', v_bill.updated_at),
    'org_discounts', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'kind', d.kind, 'value', d.value,
        'currency', d.currency, 'applies_to', d.applies_to, 'starts_at', d.starts_at, 'ends_at', d.ends_at,
        'active', d.active, 'code', d.code, 'max_uses', d.max_uses, 'uses', d.uses,
        'redeemed', exists (select 1 from public.discount_redemptions r
          where r.discount_id = d.id and r.organization_id = p_org),
        'in_effect', d.id in (select private.org_discount_ids(p_org)))
        order by d.created_at desc)
      from public.discounts d
      where d.organization_id = p_org
         or exists (select 1 from public.discount_redemptions r where r.discount_id = d.id and r.organization_id = p_org)),
      '[]'::jsonb));
end;
$$;

create or replace function public.admin_set_org_billing(
  p_org uuid,
  p_plan_key text,
  p_status text default 'active',
  p_custom_price integer default null,
  p_currency text default 'usd',
  p_note text default null,
  p_next_due_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text;
  v_currency text;
begin
  perform private.assert_platform_admin();
  perform private.assert_billing_org(p_org);
  if not exists (select 1 from public.plans p where p.key = p_plan_key and p.active) then
    raise exception 'plan_not_found' using errcode = 'PT404';
  end if;
  if p_status is null or p_status not in ('active', 'trial', 'past_due', 'suspended') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_custom_price is not null then
    perform private.check_amount(p_custom_price, true);
  end if;
  v_currency := private.clean_currency(p_currency);
  v_note := private.check_text(p_note, 1000, 'note', true);

  insert into public.organization_billing as b
    (organization_id, plan_key, status, custom_price, currency, billing_note, next_due_date, updated_by)
  values (p_org, p_plan_key, p_status, p_custom_price, v_currency, v_note, p_next_due_date, auth.uid())
  on conflict (organization_id) do update set
    plan_key = excluded.plan_key, status = excluded.status, custom_price = excluded.custom_price,
    currency = excluded.currency, billing_note = excluded.billing_note,
    next_due_date = excluded.next_due_date, updated_by = excluded.updated_by;

  perform private.hq_log('billing.org_updated', 'organization', p_org::text,
    jsonb_build_object('plan', p_plan_key, 'status', p_status, 'custom_price', p_custom_price,
      'currency', v_currency, 'next_due_date', p_next_due_date, 'has_note', v_note is not null));
end;
$$;

-- A charge. The amount is the subscription price when p_amount is null and
-- kind = subscription; the best discount is applied unless p_apply_discount is false.
create or replace function public.admin_create_charge(
  p_org uuid,
  p_kind text,
  p_label text,
  p_description text default null,
  p_amount integer default null,
  p_currency text default null,
  p_due_date date default null,
  p_apply_discount boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price record;
  v_base integer;
  v_currency text;
  v_label text;
  v_desc text;
  v_disc_id uuid;
  v_disc_label text;
  v_disc_amount integer := 0;
  v_row public.billing_charges;
begin
  perform private.assert_platform_admin();
  perform private.assert_billing_org(p_org);
  if p_kind is null or p_kind not in ('setup', 'subscription', 'one_off') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  v_label := private.check_text(p_label, 120, 'label');
  if v_label is null then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  v_desc := private.check_text(p_description, 1000, 'description', true);

  select * into v_price from private.effective_price(p_org);
  if p_amount is null and p_kind = 'subscription' then
    if v_price.price is null then
      raise exception 'price_not_set' using errcode = 'PT409';
    end if;
    v_base := private.check_amount(v_price.price);
    v_currency := v_price.currency;
  else
    v_base := private.check_amount(p_amount);
    v_currency := private.clean_currency(coalesce(p_currency, v_price.currency));
  end if;

  if coalesce(p_apply_discount, true) then
    select b.discount_id, b.label, b.amount into v_disc_id, v_disc_label, v_disc_amount
    from private.best_discount(p_org, p_kind, v_currency, v_base) b;
  end if;

  insert into public.billing_charges
    (organization_id, label, description, kind, base_amount, discount_id, discount_label,
     discount_amount, currency, due_date, created_by)
  values (p_org, v_label, v_desc, p_kind, v_base, v_disc_id, v_disc_label,
     coalesce(v_disc_amount, 0), v_currency, p_due_date, auth.uid())
  returning * into v_row;

  -- An organization discount with a use limit counts the charges it reduced.
  if v_disc_id is not null then
    update public.discounts set uses = uses + 1
    where id = v_disc_id and code is null and max_uses is not null;
  end if;

  perform private.hq_log('billing.charge_created', 'organization', p_org::text,
    jsonb_build_object('charge_id', v_row.id, 'kind', p_kind, 'base_amount', v_base,
      'discount_amount', v_row.discount_amount, 'amount', v_row.amount, 'currency', v_currency));
  return private.charge_json(v_row);
end;
$$;

-- Only a charge still due can change; the discount is recomputed on the new amount.
create or replace function public.admin_update_charge(
  p_id uuid,
  p_label text,
  p_description text default null,
  p_amount integer default null,
  p_due_date date default null,
  p_apply_discount boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.billing_charges;
  v_label text;
  v_disc_id uuid;
  v_disc_label text;
  v_disc_amount integer := 0;
  v_base integer;
begin
  perform private.assert_platform_admin();
  select * into v_row from public.billing_charges where id = p_id for update;
  if not found then
    raise exception 'charge_not_found' using errcode = 'PT404';
  end if;
  if v_row.status <> 'due' then
    raise exception 'charge_closed' using errcode = 'PT409';
  end if;
  v_label := private.check_text(p_label, 120, 'label');
  if v_label is null then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  v_base := private.check_amount(coalesce(p_amount, v_row.base_amount));
  if coalesce(p_apply_discount, true) then
    select b.discount_id, b.label, b.amount into v_disc_id, v_disc_label, v_disc_amount
    from private.best_discount(v_row.organization_id, v_row.kind, v_row.currency, v_base) b;
  end if;

  update public.billing_charges set
    label = v_label,
    description = private.check_text(p_description, 1000, 'description', true),
    base_amount = v_base,
    discount_id = v_disc_id,
    discount_label = v_disc_label,
    discount_amount = coalesce(v_disc_amount, 0),
    due_date = p_due_date
  where id = p_id
  returning * into v_row;

  perform private.hq_log('billing.charge_updated', 'organization', v_row.organization_id::text,
    jsonb_build_object('charge_id', v_row.id, 'base_amount', v_base,
      'discount_amount', v_row.discount_amount, 'amount', v_row.amount, 'currency', v_row.currency));
  return private.charge_json(v_row);
end;
$$;

create or replace function public.admin_void_charge(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.billing_charges;
begin
  perform private.assert_platform_admin();
  select * into v_row from public.billing_charges where id = p_id for update;
  if not found then
    raise exception 'charge_not_found' using errcode = 'PT404';
  end if;
  if v_row.status = 'paid' then
    raise exception 'charge_paid' using errcode = 'PT409';
  end if;
  if v_row.status = 'void' then
    return private.charge_json(v_row);
  end if;
  update public.billing_charges
  set status = 'void', void_reason = private.check_text(p_reason, 300, 'reason')
  where id = p_id returning * into v_row;
  perform private.hq_log('billing.charge_voided', 'organization', v_row.organization_id::text,
    jsonb_build_object('charge_id', v_row.id, 'amount', v_row.amount, 'currency', v_row.currency));
  return private.charge_json(v_row);
end;
$$;

-- Paid outside the app (bank transfer, cheque, …): recorded by staff.
create or replace function public.admin_mark_charge_paid(
  p_id uuid,
  p_paid_at timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.billing_charges;
begin
  perform private.assert_platform_admin();
  select * into v_row from public.billing_charges where id = p_id for update;
  if not found then
    raise exception 'charge_not_found' using errcode = 'PT404';
  end if;
  if v_row.status = 'void' then
    raise exception 'charge_closed' using errcode = 'PT409';
  end if;
  if v_row.status = 'paid' then
    return private.charge_json(v_row);
  end if;
  if p_paid_at is not null and p_paid_at > now() + interval '1 day' then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  update public.billing_charges
  set status = 'paid', paid_at = coalesce(p_paid_at, now()),
      payment_note = private.check_text(p_note, 300, 'note')
  where id = p_id returning * into v_row;
  perform private.hq_log('billing.charge_paid', 'organization', v_row.organization_id::text,
    jsonb_build_object('charge_id', v_row.id, 'amount', v_row.amount, 'currency', v_row.currency));
  return private.charge_json(v_row);
end;
$$;

-- Create (p_id null) or edit a discount. The organization and the code of an
-- existing discount never change (create a new one instead).
create or replace function public.admin_save_discount(
  p_id uuid,
  p_org uuid,
  p_code text,
  p_label text,
  p_kind text,
  p_value integer,
  p_currency text default null,
  p_applies_to text default 'all',
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_max_uses integer default null,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text := nullif(upper(btrim(coalesce(p_code, ''))), '');
  v_label text := private.check_text(p_label, 60, 'label');
  v_currency text;
  v_org uuid;
begin
  perform private.assert_platform_admin();
  if v_label is null then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('percent', 'fixed') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_value is null or p_value < 1 or (p_kind = 'percent' and p_value > 100) or p_value > 100000000 then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  v_currency := case when p_kind = 'fixed' then private.clean_currency(p_currency) end;
  if p_applies_to is null or p_applies_to not in ('subscription', 'setup', 'all') then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  if p_ends_at is not null and p_starts_at is not null and p_ends_at <= p_starts_at then
    raise exception 'invalid_dates' using errcode = '22023';
  end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 100000) then
    raise exception 'invalid_values' using errcode = '22023';
  end if;

  if p_id is null then
    if p_org is not null then
      perform private.assert_billing_org(p_org);
    end if;
    if v_code is not null and v_code !~ '^[A-Z0-9][A-Z0-9-]{2,31}$' then
      raise exception 'invalid_code' using errcode = '22023';
    end if;
    if p_org is null and v_code is null then
      raise exception 'invalid_values' using errcode = '22023';
    end if;
    begin
      insert into public.discounts (organization_id, code, label, kind, value, currency, applies_to,
        starts_at, ends_at, max_uses, active, created_by)
      values (p_org, v_code, v_label, p_kind, p_value, v_currency, p_applies_to,
        p_starts_at, p_ends_at, p_max_uses, coalesce(p_active, true), auth.uid())
      returning id into v_id;
    exception when unique_violation then
      raise exception 'code_taken' using errcode = 'PT409';
    end;
    perform private.hq_log('billing.discount_created',
      case when p_org is not null then 'organization' end, coalesce(p_org::text, v_id::text),
      jsonb_build_object('discount_id', v_id, 'has_code', v_code is not null, 'label', v_label,
        'kind', p_kind, 'value', p_value, 'currency', v_currency, 'applies_to', p_applies_to));
  else
    update public.discounts set
      label = v_label, kind = p_kind, value = p_value, currency = v_currency, applies_to = p_applies_to,
      starts_at = p_starts_at, ends_at = p_ends_at, max_uses = p_max_uses, active = coalesce(p_active, active)
    where id = p_id
    returning id, organization_id into v_id, v_org;
    if v_id is null then
      raise exception 'discount_not_found' using errcode = 'PT404';
    end if;
    perform private.hq_log('billing.discount_updated',
      case when v_org is not null then 'organization' end, coalesce(v_org::text, v_id::text),
      jsonb_build_object('discount_id', v_id, 'label', v_label, 'kind', p_kind, 'value', p_value, 'currency', v_currency,
        'applies_to', p_applies_to, 'active', p_active));
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_set_discount_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  perform private.assert_platform_admin();
  update public.discounts set active = coalesce(p_active, false) where id = p_id
  returning organization_id into v_org;
  if not found then
    raise exception 'discount_not_found' using errcode = 'PT404';
  end if;
  perform private.hq_log(case when p_active then 'billing.discount_activated' else 'billing.discount_deactivated' end,
    case when v_org is not null then 'organization' end, coalesce(v_org::text, p_id::text),
    jsonb_build_object('discount_id', p_id));
end;
$$;

-- Create or edit a plan. p_price null = "price to be set" (never shown as a number).
create or replace function public.admin_save_plan(
  p_key text,
  p_name text,
  p_description text,
  p_price integer,
  p_currency text,
  p_limits jsonb,
  p_features text[],
  p_sort_order integer default 0,
  p_active boolean default true,
  p_is_default boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_name text := private.check_text(p_name, 60, 'name');
  v_features text[];
  v_limits jsonb;
  v_was_default boolean;
begin
  perform private.assert_platform_admin();
  if v_key !~ '^[a-z][a-z0-9_]{1,31}$' then
    raise exception 'invalid_key' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_price is not null then
    perform private.check_amount(p_price, true);
  end if;
  v_limits := private.clean_plan_limits(coalesce(p_limits, '{}'::jsonb));
  select coalesce(array_agg(distinct f order by f), '{}') into v_features
  from unnest(coalesce(p_features, '{}')) f;
  if cardinality(v_features) > 30 or exists (select 1 from unnest(v_features) f where f !~ '^[a-z][a-z0-9_]{1,39}$') then
    raise exception 'invalid_features' using errcode = '22023';
  end if;
  select is_default into v_was_default from public.plans where key = v_key;
  if coalesce(v_was_default, false) and (not coalesce(p_active, true) or not coalesce(p_is_default, false)) then
    -- Choose another default plan first.
    raise exception 'default_plan_required' using errcode = 'PT409';
  end if;
  if not coalesce(p_active, true) and exists (
    select 1 from public.organization_billing b where b.plan_key = v_key
  ) then
    raise exception 'plan_in_use' using errcode = 'PT409';
  end if;
  if coalesce(p_is_default, false) then
    if not coalesce(p_active, true) then
      raise exception 'default_plan_required' using errcode = 'PT409';
    end if;
    update public.plans set is_default = false where is_default and key <> v_key;
  end if;

  insert into public.plans as p (key, name, description, price_monthly, currency, limits, features,
    sort_order, active, is_default)
  values (v_key, v_name, private.check_text(p_description, 500, 'description', true), p_price,
    private.clean_currency(p_currency), v_limits, v_features, coalesce(p_sort_order, 0),
    coalesce(p_active, true), coalesce(p_is_default, false))
  on conflict (key) do update set
    name = excluded.name, description = excluded.description, price_monthly = excluded.price_monthly,
    currency = excluded.currency, limits = excluded.limits, features = excluded.features,
    sort_order = excluded.sort_order, active = excluded.active, is_default = excluded.is_default;

  -- hq_audit_log has no `plan` target type: the key is the target id.
  perform private.hq_log('billing.plan_saved', null, v_key,
    jsonb_build_object('price', p_price, 'currency', lower(p_currency), 'limits', v_limits,
      'features', to_jsonb(v_features), 'active', p_active, 'is_default', p_is_default));
end;
$$;

create or replace function public.admin_list_upgrade_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'organization_id', r.organization_id, 'organization_name', o.name,
      'plan_key', r.plan_key, 'plan_name', p.name, 'from_plan_key', r.from_plan_key,
      'from_plan_name', fp.name, 'message', r.message, 'status', r.status,
      'requested_by_email', (select u.email from auth.users u where u.id = r.requested_by),
      'created_at', r.created_at, 'decided_at', r.decided_at, 'decision_note', r.decision_note)
      order by (r.status = 'pending') desc, r.created_at desc)
    from (select * from public.plan_upgrade_requests
          where status = 'pending' or created_at > now() - interval '90 days'
          order by created_at desc limit 200) r
    join public.organizations o on o.id = r.organization_id
    join public.plans p on p.key = r.plan_key
    left join public.plans fp on fp.key = r.from_plan_key), '[]'::jsonb);
end;
$$;

-- Approve: the organization moves to the plan asked for. Decline: closed.
create or replace function public.admin_decide_upgrade_request(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.plan_upgrade_requests;
begin
  perform private.assert_platform_admin();
  select * into v_req from public.plan_upgrade_requests where id = p_id for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'PT404';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'request_closed' using errcode = 'PT409';
  end if;
  if p_approve then
    if not exists (select 1 from public.plans p where p.key = v_req.plan_key and p.active) then
      raise exception 'plan_not_found' using errcode = 'PT404';
    end if;
    insert into public.organization_billing as b (organization_id, plan_key, currency, updated_by)
    values (v_req.organization_id, v_req.plan_key,
      (select p.currency from public.plans p where p.key = v_req.plan_key), auth.uid())
    on conflict (organization_id) do update set plan_key = excluded.plan_key, updated_by = excluded.updated_by;
  end if;
  update public.plan_upgrade_requests
  set status = case when p_approve then 'approved' else 'declined' end,
      decided_at = now(), decided_by = auth.uid(),
      decision_note = private.check_text(p_note, 500, 'note', true)
  where id = p_id;
  perform private.hq_log(case when p_approve then 'billing.upgrade_approved' else 'billing.upgrade_declined' end,
    'organization', v_req.organization_id::text,
    jsonb_build_object('request_id', p_id, 'plan', v_req.plan_key, 'from_plan', v_req.from_plan_key));
end;
$$;

-- @part 6: grants -----------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'private.billing_limit_keys()', 'private.clean_plan_limits(jsonb)', 'private.org_plan_key(uuid)',
    'private.plan_limit(uuid, text)', 'private.team_seats_used(uuid, text)', 'private.org_usage(uuid, text)',
    'private.assert_within_limit(uuid, text, numeric, numeric)', 'private.effective_price(uuid)',
    'private.discount_off(text, integer, integer)', 'private.org_discount_ids(uuid)',
    'private.best_discount(uuid, text, text, integer)', 'private.charge_json(public.billing_charges)',
    'private.discount_json(public.discounts)', 'private.assert_billing_org(uuid)',
    'private.clean_currency(text)', 'private.check_amount(integer, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.billing_summary(uuid)', 'public.redeem_discount_code(uuid, text)',
    'public.request_plan_upgrade(uuid, text, text)', 'public.admin_list_billing_orgs()',
    'public.admin_get_org_billing(uuid)',
    'public.admin_set_org_billing(uuid, text, text, integer, text, text, date)',
    'public.admin_create_charge(uuid, text, text, text, integer, text, date, boolean)',
    'public.admin_update_charge(uuid, text, text, integer, date, boolean)',
    'public.admin_void_charge(uuid, text)', 'public.admin_mark_charge_paid(uuid, timestamptz, text)',
    'public.admin_save_discount(uuid, uuid, text, text, text, integer, text, text, timestamptz, timestamptz, integer, boolean)',
    'public.admin_set_discount_active(uuid, boolean)',
    'public.admin_save_plan(text, text, text, integer, text, jsonb, text[], integer, boolean, boolean)',
    'public.admin_list_upgrade_requests()', 'public.admin_decide_upgrade_request(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
