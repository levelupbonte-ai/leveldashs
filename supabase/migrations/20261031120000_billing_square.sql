-- Square as a second online payment provider for LevelUp invoices (next to Stripe).
-- Still switched off: nothing changes until the dashboard has LEVELUP_ONLINE_PAYMENTS=on
-- and the Square keys (see docs/billing.md → Turning on Square).
--
-- How a Square payment finds its charge:
--   * the checkout route creates a payment link (quick_pay) for the exact amount of the
--     charge; Square creates an order for it. The route records the link id on the
--     attempt (private.billing_checkouts.session_id) and the order id in
--     private.billing_square_orders (every order ever created for a charge, so a late
--     payment of an older link still maps back);
--   * the payment note carries the charge id too (cross-check);
--   * the webhook (payment.created / payment.updated, signature checked by the route)
--     calls public.billing_ingest_stripe_event with provider 'square': the order gives
--     the charge, the amount and currency must match, the charge is paid once.
--
-- No data is changed: constraints are widened, one table and one function are added,
-- billing_ingest_stripe_event keeps its Stripe behaviour byte for byte.

-- @part 1: constraints -------------------------------------------------------------------

alter table public.billing_charges drop constraint if exists billing_charges_payment_provider_check;
alter table public.billing_charges add constraint billing_charges_payment_provider_check
  check (payment_provider is null or payment_provider in ('stripe', 'square'));

alter table public.billing_payment_events drop constraint if exists billing_payment_events_provider_check;
alter table public.billing_payment_events add constraint billing_payment_events_provider_check
  check (provider in ('stripe', 'square'));

alter table public.billing_payment_events drop constraint if exists billing_payment_events_event_type_check;
alter table public.billing_payment_events add constraint billing_payment_events_event_type_check
  check (event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed', 'checkout.session.expired',
    'payment.created', 'payment.updated'));

-- 'duplicate': another event about a payment that was already applied (Square sends
-- payment.created then several payment.updated for one payment).
alter table public.billing_payment_events drop constraint if exists billing_payment_events_outcome_check;
alter table public.billing_payment_events add constraint billing_payment_events_outcome_check
  check (outcome in ('received', 'paid', 'already_paid', 'amount_mismatch', 'unknown_charge',
    'charge_closed', 'not_paid', 'expired', 'duplicate'));

-- Stripe Checkout Session ids (cs_…) or Square payment link ids (letters and digits).
alter table private.billing_checkouts drop constraint if exists billing_checkouts_session_id_check;
alter table private.billing_checkouts add constraint billing_checkouts_session_id_check
  check (session_id is null or session_id ~ '^cs_(test|live)_[A-Za-z0-9]{8,250}$'
    or session_id ~ '^[A-Za-z0-9]{8,64}$');

-- @part 2: Square orders → charges -------------------------------------------------------

create table if not exists private.billing_square_orders (
  order_id text primary key check (order_id ~ '^[A-Za-z0-9_-]{8,255}$'),
  charge_id uuid not null references public.billing_charges (id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  link_id text not null check (link_id ~ '^[A-Za-z0-9]{8,64}$'),
  created_at timestamptz not null default now()
);
create index if not exists billing_square_orders_charge_idx on private.billing_square_orders (charge_id);
alter table private.billing_square_orders enable row level security;
revoke all on table private.billing_square_orders from public, anon, authenticated;

-- The route records the payment link Square created for an attempt and its order
-- (first one wins for the attempt; every order is kept for the webhook).
create or replace function public.billing_checkout_record_square(
  p_charge uuid, p_attempt integer, p_link_id text, p_order_id text)
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
  if p_link_id is null or p_link_id !~ '^[A-Za-z0-9]{8,64}$'
     or p_order_id is null or p_order_id !~ '^[A-Za-z0-9_-]{8,255}$'
     or p_attempt is null or p_attempt < 1 then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  -- Only the charge's current attempt.
  if not exists (select 1 from private.billing_checkouts k where k.charge_id = p_charge and k.attempt = p_attempt) then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  insert into private.billing_square_orders (order_id, charge_id, attempt, link_id)
  values (p_order_id, p_charge, p_attempt, p_link_id)
  on conflict (order_id) do nothing;
  -- An order already recorded for another charge is never moved.
  if not exists (select 1 from private.billing_square_orders o where o.order_id = p_order_id and o.charge_id = p_charge) then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  update private.billing_checkouts set session_id = p_link_id, previous_session_id = null, updated_at = now()
  where charge_id = p_charge and attempt = p_attempt and session_id is null;
end;
$$;

revoke all on function public.billing_checkout_record_square(uuid, integer, text, text) from public, anon;
grant execute on function public.billing_checkout_record_square(uuid, integer, text, text) to authenticated;

-- @part 3: webhook (server path only: the billing webhook key) -----------------------------

-- p_event (Stripe, unchanged): { event_id, type, session_id, charge_id, organization_id,
--   amount, currency, payment_status, payment_intent, livemode }.
-- p_event (Square): { provider: 'square', event_id, type: payment.created|payment.updated,
--   payment_id, order_id, charge_id (from the payment note), amount (amount_money, minor
--   units), currency, payment_status (COMPLETED = paid), livemode }.
-- Returns { status }: paid | duplicate | already_paid | amount_mismatch | unknown_charge |
-- charge_closed | not_paid | expired.
create or replace function public.billing_ingest_stripe_event(p_key text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
  v_event_id text;
  v_type text;
  v_session text;
  v_charge_id uuid;
  v_org uuid;
  v_amount bigint;
  v_currency text;
  v_status text;
  v_intent text;
  v_live boolean;
  v_paid boolean;
  v_c public.billing_charges;
  v_eid bigint;
  v_outcome text;
begin
  perform private.assert_billing_key(p_key);
  if p_event is null or jsonb_typeof(p_event) <> 'object' or octet_length(p_event::text) > 8192 then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  v_provider := coalesce(p_event ->> 'provider', 'stripe');
  v_event_id := p_event ->> 'event_id';
  v_type := p_event ->> 'type';
  v_amount := case when jsonb_typeof(p_event -> 'amount') = 'number' then (p_event ->> 'amount')::numeric::bigint end;
  v_currency := lower(nullif(p_event ->> 'currency', ''));
  if v_currency is not null and v_currency !~ '^[a-z]{3}$' then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  v_status := p_event ->> 'payment_status';
  v_live := coalesce((p_event ->> 'livemode')::boolean, false);

  if v_provider = 'stripe' then
    v_session := p_event ->> 'session_id';
    if v_event_id is null or v_event_id !~ '^evt_[A-Za-z0-9]{8,250}$'
       or v_type is null or v_type not in ('checkout.session.completed', 'checkout.session.async_payment_succeeded',
         'checkout.session.async_payment_failed', 'checkout.session.expired')
       or v_session is null or v_session !~ '^cs_(test|live)_[A-Za-z0-9]{8,250}$' then
      raise exception 'invalid_event' using errcode = '22023';
    end if;
    v_charge_id := private.safe_uuid(p_event ->> 'charge_id');
    v_org := private.safe_uuid(p_event ->> 'organization_id');
    v_intent := left(nullif(p_event ->> 'payment_intent', ''), 255);
    v_paid := v_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
      and coalesce(v_status, '') = 'paid';
  elsif v_provider = 'square' then
    -- The order id plays the session's part; the payment id is the reference.
    v_session := p_event ->> 'order_id';
    v_intent := p_event ->> 'payment_id';
    if v_event_id is null or v_event_id !~ '^[A-Za-z0-9_-]{8,255}$'
       or v_type is null or v_type not in ('payment.created', 'payment.updated')
       or v_session is null or v_session !~ '^[A-Za-z0-9_-]{8,255}$'
       or v_intent is null or v_intent !~ '^[A-Za-z0-9_-]{8,255}$' then
      raise exception 'invalid_event' using errcode = '22023';
    end if;
    -- The charge comes from our own record of the order, never from the payload alone.
    select o.charge_id into v_charge_id from private.billing_square_orders o where o.order_id = v_session;
    -- The payment note must not name another charge.
    if v_charge_id is not null and private.safe_uuid(p_event ->> 'charge_id') is distinct from v_charge_id
       and p_event ->> 'charge_id' is not null then
      v_charge_id := null;
    end if;
    v_paid := coalesce(v_status, '') = 'COMPLETED';
  else
    raise exception 'invalid_event' using errcode = '22023';
  end if;

  if v_charge_id is not null then
    select * into v_c from public.billing_charges where id = v_charge_id for update;
  end if;
  if v_provider = 'square' then
    v_org := v_c.organization_id;
  end if;

  insert into public.billing_payment_events (provider, provider_event_id, event_type, charge_id, organization_id,
    provider_session_id, amount, currency, livemode)
  values (v_provider, v_event_id, v_type, v_c.id, v_c.organization_id, v_session, v_amount, v_currency, v_live)
  on conflict (provider_event_id) do nothing
  returning id into v_eid;
  if v_eid is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if v_c.id is null or v_c.organization_id is distinct from v_org then
    v_outcome := 'unknown_charge';
  elsif v_type = 'checkout.session.expired' then
    update private.billing_checkouts set expires_at = now(), updated_at = now()
    where charge_id = v_c.id and session_id = v_session;
    v_outcome := 'expired';
  elsif not v_paid then
    v_outcome := 'not_paid';
  elsif v_provider = 'square' and v_c.status = 'paid' and v_c.payment_provider = 'square'
     and v_c.payment_reference = v_intent then
    -- Another notification about the payment already applied.
    v_outcome := 'duplicate';
  elsif v_c.status = 'paid' then
    v_outcome := 'already_paid';
  elsif v_c.status = 'void' then
    v_outcome := 'charge_closed';
  elsif v_amount is distinct from v_c.amount::bigint or v_currency is distinct from v_c.currency then
    v_outcome := 'amount_mismatch';
  else
    update public.billing_charges set
      status = 'paid', paid_at = now(), payment_method = 'card', payment_provider = v_provider,
      provider_session_id = v_session, payment_reference = coalesce(v_intent, v_session),
      paid_amount = v_amount::integer
    where id = v_c.id;
    update private.billing_checkouts set expires_at = now(), updated_at = now() where charge_id = v_c.id;
    v_outcome := 'paid';
  end if;

  update public.billing_payment_events set outcome = v_outcome where id = v_eid;
  -- Paid: the receipt exists. Anything else that took money needs a human.
  if v_outcome in ('paid', 'already_paid', 'charge_closed', 'amount_mismatch')
     or (v_outcome = 'unknown_charge' and v_type <> 'checkout.session.expired'
         and (v_provider = 'stripe' or v_paid)) then
    perform private.hq_log(case v_outcome when 'paid' then 'billing.charge_paid_online'
        else 'billing.online_payment_' || v_outcome end,
      case when v_c.organization_id is not null then 'organization' end,
      coalesce(v_c.organization_id::text, v_session),
      jsonb_build_object('provider', v_provider, 'charge_id', v_c.id, 'invoice_number', v_c.invoice_number,
        'session_id', v_session, 'payment_id', case when v_provider = 'square' then v_intent end,
        'event_id', v_event_id, 'amount', v_amount,
        'currency', v_currency, 'expected_amount', v_c.amount, 'expected_currency', v_c.currency,
        'livemode', v_live));
  end if;
  return jsonb_build_object('status', v_outcome);
end;
$$;

-- Unchanged grants: anon only, gated by the billing webhook key.
revoke all on function public.billing_ingest_stripe_event(text, jsonb) from public, anon, authenticated;
grant execute on function public.billing_ingest_stripe_event(text, jsonb) to anon;
