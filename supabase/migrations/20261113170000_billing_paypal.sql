-- PayPal for LevelUp's own invoices, beside card payments (Stripe or Square).
--
-- Flow: the dashboard creates a PayPal order for the charge's current attempt
-- (billing_checkout_record_paypal records it; the checkout's session id is
-- 'pp_' || order id). The payer approves it on PayPal; LevelUp captures it
-- (return page, or the CHECKOUT.ORDER.APPROVED webhook) only while the charge
-- is due (billing_paypal_order_check), then reports the capture through
-- billing_ingest_stripe_event with provider 'paypal'. The charge always comes
-- from our own record of the order, never from the payload alone.

alter table public.billing_charges drop constraint if exists billing_charges_payment_provider_check;
alter table public.billing_charges add constraint billing_charges_payment_provider_check
  check (payment_provider is null or payment_provider in ('stripe', 'square', 'paypal'));
alter table public.billing_charges drop constraint if exists billing_charges_payment_method_check;
alter table public.billing_charges add constraint billing_charges_payment_method_check
  check (payment_method is null or payment_method in ('cash', 'bank_transfer', 'mobile_money', 'card', 'paypal', 'other'));

alter table public.billing_payment_events drop constraint if exists billing_payment_events_provider_check;
alter table public.billing_payment_events add constraint billing_payment_events_provider_check
  check (provider in ('stripe', 'square', 'paypal'));
alter table public.billing_payment_events drop constraint if exists billing_payment_events_event_type_check;
alter table public.billing_payment_events add constraint billing_payment_events_event_type_check
  check (event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed', 'checkout.session.expired', 'payment.created', 'payment.updated',
    'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED'));

alter table private.billing_checkouts drop constraint if exists billing_checkouts_session_id_check;
alter table private.billing_checkouts add constraint billing_checkouts_session_id_check
  check (session_id is null or session_id ~ '^cs_(test|live)_[A-Za-z0-9]{8,250}$'
    or session_id ~ '^[A-Za-z0-9]{8,64}$' or session_id ~ '^pp_[A-Z0-9]{8,64}$');

create table if not exists private.billing_paypal_orders (
  order_id text primary key check (order_id ~ '^[A-Z0-9]{8,64}$'),
  charge_id uuid not null references public.billing_charges (id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  created_at timestamptz not null default now()
);
create index if not exists billing_paypal_orders_charge_idx on private.billing_paypal_orders (charge_id);
alter table private.billing_paypal_orders enable row level security;

create or replace function public.billing_checkout_record_paypal(p_charge uuid, p_attempt integer, p_order_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  select c.organization_id into v_org from public.billing_charges c where c.id = p_charge;
  if v_org is null or not private.has_org_role(v_org, 'admin') then
    raise exception 'charge_not_found' using errcode = 'PT404';
  end if;
  if p_order_id is null or p_order_id !~ '^[A-Z0-9]{8,64}$' or p_attempt is null or p_attempt < 1 then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  if not exists (select 1 from private.billing_checkouts k where k.charge_id = p_charge and k.attempt = p_attempt) then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  insert into private.billing_paypal_orders (order_id, charge_id, attempt)
  values (p_order_id, p_charge, p_attempt)
  on conflict (order_id) do nothing;
  if not exists (select 1 from private.billing_paypal_orders o where o.order_id = p_order_id and o.charge_id = p_charge) then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  update private.billing_checkouts set session_id = 'pp_' || p_order_id, previous_session_id = null, updated_at = now()
  where charge_id = p_charge and attempt = p_attempt and session_id is null;
end;
$$;

-- Server only (billing key): may this approved order be captured now?
create or replace function public.billing_paypal_order_check(p_key text, p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o private.billing_paypal_orders; c public.billing_charges;
begin
  perform private.assert_billing_key(p_key);
  if p_order_id is null or p_order_id !~ '^[A-Z0-9]{8,64}$' then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  select * into o from private.billing_paypal_orders where order_id = p_order_id;
  if o.order_id is null then
    return jsonb_build_object('known', false);
  end if;
  select * into c from public.billing_charges where id = o.charge_id;
  return jsonb_build_object(
    'known', true,
    'charge_id', c.id,
    'due', c.status in ('due', 'overdue'),
    'amount', c.amount,
    'currency', c.currency);
end;
$$;

-- Starts a new attempt on purpose (the payer switched between card and PayPal).
create or replace function public.billing_checkout_restart(p_charge uuid, p_attempt integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  select c.organization_id into v_org from public.billing_charges c where c.id = p_charge;
  if v_org is null or not private.has_org_role(v_org, 'admin') then
    raise exception 'charge_not_found' using errcode = 'PT404';
  end if;
  update private.billing_checkouts set expires_at = now(), updated_at = now()
  where charge_id = p_charge and attempt = p_attempt;
end;
$$;

-- billing_ingest_stripe_event learns PayPal captures.
do $patch$
declare
  v_def text;
  v_new text;
  v_pair text[];
  v_branch text := $b$  elsif v_provider = 'paypal' then
    -- The order id plays the session's part; the capture id is the reference.
    v_session := p_event ->> 'order_id';
    v_intent := p_event ->> 'capture_id';
    if v_event_id is null or v_event_id !~ '^[A-Za-z0-9_-]{8,255}$'
       or v_type is null or v_type not in ('PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED')
       or v_session is null or v_session !~ '^[A-Z0-9]{8,64}$'
       or v_intent is null or v_intent !~ '^[A-Z0-9]{8,64}$' then
      raise exception 'invalid_event' using errcode = '22023';
    end if;
    select o.charge_id into v_charge_id from private.billing_paypal_orders o where o.order_id = v_session;
    if v_charge_id is not null and p_event ->> 'charge_id' is not null
       and private.safe_uuid(p_event ->> 'charge_id') is distinct from v_charge_id then
      v_charge_id := null;
    end if;
    v_paid := v_type = 'PAYMENT.CAPTURE.COMPLETED' and coalesce(v_status, '') = 'COMPLETED';
  else
    raise exception 'invalid_event' using errcode = '22023';
  end if;
$b$;
begin
  v_def := pg_get_functiondef('public.billing_ingest_stripe_event(text,jsonb)'::regprocedure);
  if position('''paypal''' in v_def) > 0 then
    return;
  end if;
  v_new := v_def;
  foreach v_pair slice 1 in array array[
    array[$a$  else
    raise exception 'invalid_event' using errcode = '22023';
  end if;
$a$, v_branch],
    array[$a$  if v_provider = 'square' then
    v_org := v_c.organization_id;$a$, $a$  if v_provider in ('square', 'paypal') then
    v_org := v_c.organization_id;$a$],
    array[$a$elsif v_provider = 'square' and v_c.status = 'paid' and v_c.payment_provider = 'square'$a$,
      $a$elsif v_provider in ('square', 'paypal') and v_c.status = 'paid' and v_c.payment_provider = v_provider$a$],
    array[$a$payment_method = 'card', payment_provider = v_provider,$a$,
      $a$payment_method = case when v_provider = 'paypal' then 'paypal' else 'card' end, payment_provider = v_provider,$a$],
    array[$a$'payment_id', case when v_provider = 'square' then v_intent end,$a$,
      $a$'payment_id', case when v_provider in ('square', 'paypal') then v_intent end,$a$]]
  loop
    if position(v_pair[1] in v_new) = 0 then
      raise exception 'billing_ingest_stripe_event: anchor not found: %', left(v_pair[1], 60);
    end if;
    v_new := replace(v_new, v_pair[1], v_pair[2]);
  end loop;
  execute v_new;
end;
$patch$;

revoke all on function
  public.billing_checkout_record_paypal(uuid, integer, text),
  public.billing_paypal_order_check(text, text),
  public.billing_checkout_restart(uuid, integer)
from public;
grant execute on function public.billing_checkout_record_paypal(uuid, integer, text) to authenticated;
grant execute on function public.billing_checkout_restart(uuid, integer) to authenticated;
-- Server routes call it with the billing key (role anon).
grant execute on function public.billing_paypal_order_check(text, text) to anon, authenticated;
