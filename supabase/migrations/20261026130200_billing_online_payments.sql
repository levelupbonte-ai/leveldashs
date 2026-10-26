-- Online payment of LevelUp charges (Stripe Checkout), shipped switched off: nothing
-- here does anything until the dashboard has LEVELUP_ONLINE_PAYMENTS=on and its keys
-- (see docs/billing.md).
--
-- Server-to-database authentication without a secret database key: the Stripe webhook
-- route of the dashboard runs without a user session (anon role, publishable key), so
-- the function it calls checks a **billing webhook key** instead, exactly like
-- site_ingest_payment checks a per-site server key:
--   * staff generate it with public.admin_create_billing_webhook_key() (aal2, audited):
--     `lu_bill_` + 48 hex characters, returned ONCE; only its SHA-256 is stored
--     (private.billing_webhook_keys); one key is active at a time, a new one revokes
--     the previous one;
--   * the owner puts it in the dashboard's server env LEVELUP_BILLING_KEY;
--   * public.billing_ingest_stripe_event(key, event) hashes the key it receives and
--     refuses anything else (`invalid_key`, PT401).
-- The Stripe signature is verified by the route (raw body + LEVELUP_STRIPE_WEBHOOK_SECRET)
-- before the call; the key proves the call comes from that route.
--
-- Checkout attempts (private.billing_checkouts): one live Stripe Checkout Session per
-- charge at a time. billing_checkout_prepare() locks the charge, reuses the current
-- attempt while it is open (double clicks get the same Stripe idempotency key and the
-- same session) and only opens a new attempt after the previous one expired, handing
-- back the previous session id so the route can expire it first.
--
-- The amount always comes from the charge (computed by the database); the webhook
-- function checks the paid amount and currency against it, ignores duplicates
-- (unique provider event id, and a charge is paid once) and audits what needs a
-- human (mismatch, payment of a void or already paid charge).

-- @part 1: tables ------------------------------------------------------------------------

create table if not exists private.billing_webhook_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_hint text not null check (key_hint ~ '^[0-9a-f]{4}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null
);
create unique index if not exists billing_webhook_keys_one_active
  on private.billing_webhook_keys ((true)) where revoked_at is null;
alter table private.billing_webhook_keys enable row level security;
revoke all on table private.billing_webhook_keys from public, anon, authenticated;

create table if not exists private.billing_checkouts (
  charge_id uuid primary key references public.billing_charges (id) on delete cascade,
  attempt integer not null default 0 check (attempt >= 0),
  expires_at timestamptz,
  session_id text check (session_id is null or session_id ~ '^cs_(test|live)_[A-Za-z0-9]{8,250}$'),
  previous_session_id text,
  updated_at timestamptz not null default now()
);
alter table private.billing_checkouts enable row level security;
revoke all on table private.billing_checkouts from public, anon, authenticated;

-- Every provider event received (idempotency + history). Staff read.
create table if not exists public.billing_payment_events (
  id bigint generated always as identity primary key,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_event_id text not null unique check (char_length(provider_event_id) between 1 and 255),
  event_type text not null check (event_type in ('checkout.session.completed',
    'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
    'checkout.session.expired')),
  charge_id uuid references public.billing_charges (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  provider_session_id text check (char_length(provider_session_id) <= 255),
  amount bigint check (amount is null or amount between 0 and 100000000000),
  currency text check (currency is null or currency ~ '^[a-z]{3}$'),
  livemode boolean not null default false,
  outcome text not null default 'received' check (outcome in ('received', 'paid', 'already_paid',
    'amount_mismatch', 'unknown_charge', 'charge_closed', 'not_paid', 'expired')),
  received_at timestamptz not null default now()
);
create index if not exists billing_payment_events_charge_idx
  on public.billing_payment_events (charge_id, received_at desc);
alter table public.billing_payment_events enable row level security;
revoke all on table public.billing_payment_events from public, anon, authenticated;
grant select on table public.billing_payment_events to authenticated;
drop policy if exists billing_payment_events_staff_read on public.billing_payment_events;
create policy billing_payment_events_staff_read on public.billing_payment_events
  for select to authenticated using ((select private.is_platform_admin()));

-- @part 2: the billing webhook key (staff) ------------------------------------------------

-- Returns the new key once: { key, key_hint, created_at }. Revokes the previous key.
create or replace function public.admin_create_billing_webhook_key()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := encode(extensions.gen_random_bytes(24), 'hex');
  v_key text;
  v_row private.billing_webhook_keys;
begin
  perform private.assert_platform_admin();
  perform private.hit_rate_limit('billing_webhook_key', (select auth.uid())::text, 10, interval '1 hour');
  v_key := 'lu_bill_' || v_secret;
  update private.billing_webhook_keys set revoked_at = now(), revoked_by = auth.uid()
  where revoked_at is null;
  insert into private.billing_webhook_keys (key_hash, key_hint, created_by)
  values (encode(extensions.digest(v_key, 'sha256'), 'hex'), right(v_secret, 4), auth.uid())
  returning * into v_row;
  perform private.hq_log('billing.webhook_key_created', 'key', v_row.id::text,
    jsonb_build_object('key_hint', v_row.key_hint));
  return jsonb_build_object('key', v_key, 'key_hint', v_row.key_hint, 'created_at', v_row.created_at);
end;
$$;

create or replace function public.admin_revoke_billing_webhook_key()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.assert_platform_admin();
  update private.billing_webhook_keys set revoked_at = now(), revoked_by = auth.uid()
  where revoked_at is null returning id into v_id;
  if v_id is not null then
    perform private.hq_log('billing.webhook_key_revoked', 'key', v_id::text, '{}'::jsonb);
  end if;
end;
$$;

-- { active, key_hint, created_at, last_used_at } of the active key (never the hash).
create or replace function public.admin_billing_webhook_key_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row private.billing_webhook_keys;
begin
  perform private.assert_platform_admin();
  select * into v_row from private.billing_webhook_keys where revoked_at is null;
  return jsonb_build_object('active', v_row.id is not null, 'key_hint', v_row.key_hint,
    'created_at', v_row.created_at, 'last_used_at', v_row.last_used_at);
end;
$$;

-- Raises invalid_key (PT401) unless p_key is the active billing webhook key.
create or replace function private.assert_billing_key(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_key is null or p_key !~ '^lu_bill_[0-9a-f]{48}$' then
    raise exception 'invalid_key' using errcode = 'PT401';
  end if;
  select k.id into v_id from private.billing_webhook_keys k
  where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex') and k.revoked_at is null;
  if v_id is null then
    raise exception 'invalid_key' using errcode = 'PT401';
  end if;
  update private.billing_webhook_keys set last_used_at = now()
  where id = v_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
end;
$$;

revoke all on function private.assert_billing_key(text) from public, anon, authenticated;

-- @part 3: checkout (owners and admins of the charge's organization) -----------------------

-- Locks the charge and returns what the route sends to Stripe: the exact amount and
-- currency of the charge, the attempt number (idempotency key) and its expiry.
create or replace function public.billing_checkout_prepare(p_charge uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.billing_charges;
  v_k private.billing_checkouts;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  select * into v_c from public.billing_charges where id = p_charge for update;
  if not found or not private.has_org_role(v_c.organization_id, 'admin') then
    raise exception 'charge_not_found' using errcode = 'PT404';
  end if;
  -- `due` is stored for overdue charges too.
  if v_c.status <> 'due' then
    raise exception 'charge_closed' using errcode = 'PT409';
  end if;
  if v_c.amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('billing_checkout', p_charge::text, 30, interval '1 hour');

  insert into private.billing_checkouts (charge_id) values (p_charge) on conflict (charge_id) do nothing;
  select * into v_k from private.billing_checkouts where charge_id = p_charge for update;
  -- Reuse the open attempt; a new one only when it is (almost) expired.
  if v_k.expires_at is null or v_k.expires_at <= now() + interval '2 minutes' then
    update private.billing_checkouts set
      attempt = attempt + 1,
      expires_at = date_trunc('second', now()) + interval '60 minutes',
      previous_session_id = session_id,
      session_id = null,
      updated_at = now()
    where charge_id = p_charge
    returning * into v_k;
  end if;

  return jsonb_build_object(
    'charge_id', v_c.id,
    'organization_id', v_c.organization_id,
    'organization_name', (select o.name from public.organizations o where o.id = v_c.organization_id),
    'invoice_number', v_c.invoice_number,
    'label', v_c.label,
    'amount', v_c.amount,
    'currency', v_c.currency,
    'attempt', v_k.attempt,
    'expires_at', v_k.expires_at,
    'session_id', v_k.session_id,
    'previous_session_id', v_k.previous_session_id);
end;
$$;

-- The route records the session Stripe created for an attempt (first one wins).
create or replace function public.billing_checkout_record(p_charge uuid, p_attempt integer, p_session_id text)
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
  if p_session_id is null or p_session_id !~ '^cs_(test|live)_[A-Za-z0-9]{8,250}$' then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  update private.billing_checkouts set session_id = p_session_id, previous_session_id = null, updated_at = now()
  where charge_id = p_charge and attempt = p_attempt and session_id is null;
end;
$$;

-- @part 4: webhook (server path only: the billing webhook key) -----------------------------

-- p_event: { event_id, type, session_id, charge_id, organization_id, amount, currency,
--            payment_status, payment_intent, livemode } from a verified Stripe event.
-- Returns { status }: paid | duplicate | already_paid | amount_mismatch | unknown_charge |
-- charge_closed | not_paid | expired.
create or replace function public.billing_ingest_stripe_event(p_key text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  v_c public.billing_charges;
  v_eid bigint;
  v_outcome text;
begin
  perform private.assert_billing_key(p_key);
  if p_event is null or jsonb_typeof(p_event) <> 'object' or octet_length(p_event::text) > 8192 then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  v_event_id := p_event ->> 'event_id';
  v_type := p_event ->> 'type';
  v_session := p_event ->> 'session_id';
  if v_event_id is null or v_event_id !~ '^evt_[A-Za-z0-9]{8,250}$'
     or v_type is null or v_type not in ('checkout.session.completed', 'checkout.session.async_payment_succeeded',
       'checkout.session.async_payment_failed', 'checkout.session.expired')
     or v_session is null or v_session !~ '^cs_(test|live)_[A-Za-z0-9]{8,250}$' then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  v_charge_id := private.safe_uuid(p_event ->> 'charge_id');
  v_org := private.safe_uuid(p_event ->> 'organization_id');
  v_amount := case when jsonb_typeof(p_event -> 'amount') = 'number' then (p_event ->> 'amount')::numeric::bigint end;
  v_currency := lower(nullif(p_event ->> 'currency', ''));
  if v_currency is not null and v_currency !~ '^[a-z]{3}$' then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  v_status := p_event ->> 'payment_status';
  v_intent := left(nullif(p_event ->> 'payment_intent', ''), 255);
  v_live := coalesce((p_event ->> 'livemode')::boolean, false);

  if v_charge_id is not null then
    select * into v_c from public.billing_charges where id = v_charge_id for update;
  end if;

  insert into public.billing_payment_events (provider_event_id, event_type, charge_id, organization_id,
    provider_session_id, amount, currency, livemode)
  values (v_event_id, v_type, v_c.id, v_c.organization_id, v_session, v_amount, v_currency, v_live)
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
  elsif v_type = 'checkout.session.async_payment_failed' or coalesce(v_status, '') <> 'paid' then
    v_outcome := 'not_paid';
  elsif v_c.status = 'paid' then
    v_outcome := 'already_paid';
  elsif v_c.status = 'void' then
    v_outcome := 'charge_closed';
  elsif v_amount is distinct from v_c.amount::bigint or v_currency is distinct from v_c.currency then
    v_outcome := 'amount_mismatch';
  else
    update public.billing_charges set
      status = 'paid', paid_at = now(), payment_method = 'card', payment_provider = 'stripe',
      provider_session_id = v_session, payment_reference = coalesce(v_intent, v_session),
      paid_amount = v_amount::integer
    where id = v_c.id;
    update private.billing_checkouts set expires_at = now(), updated_at = now() where charge_id = v_c.id;
    v_outcome := 'paid';
  end if;

  update public.billing_payment_events set outcome = v_outcome where id = v_eid;
  -- Paid: the receipt exists. Anything else that took money needs a human.
  if v_outcome in ('paid', 'already_paid', 'charge_closed', 'amount_mismatch')
     or (v_outcome = 'unknown_charge' and v_type <> 'checkout.session.expired') then
    perform private.hq_log(case v_outcome when 'paid' then 'billing.charge_paid_online'
        else 'billing.online_payment_' || v_outcome end,
      case when v_c.organization_id is not null then 'organization' end,
      coalesce(v_c.organization_id::text, v_session),
      jsonb_build_object('charge_id', v_c.id, 'invoice_number', v_c.invoice_number,
        'session_id', v_session, 'event_id', v_event_id, 'amount', v_amount,
        'currency', v_currency, 'expected_amount', v_c.amount, 'expected_currency', v_c.currency,
        'livemode', v_live));
  end if;
  return jsonb_build_object('status', v_outcome);
end;
$$;

-- @part 5: grants -------------------------------------------------------------------------

revoke all on function public.admin_create_billing_webhook_key() from public, anon;
revoke all on function public.admin_revoke_billing_webhook_key() from public, anon;
revoke all on function public.admin_billing_webhook_key_status() from public, anon;
revoke all on function public.billing_checkout_prepare(uuid) from public, anon;
revoke all on function public.billing_checkout_record(uuid, integer, text) from public, anon;
grant execute on function public.admin_create_billing_webhook_key() to authenticated;
grant execute on function public.admin_revoke_billing_webhook_key() to authenticated;
grant execute on function public.admin_billing_webhook_key_status() to authenticated;
grant execute on function public.billing_checkout_prepare(uuid) to authenticated;
grant execute on function public.billing_checkout_record(uuid, integer, text) to authenticated;
-- The webhook route has no user session: anon only, gated by the billing webhook key.
revoke all on function public.billing_ingest_stripe_event(text, jsonb) from public, anon, authenticated;
grant execute on function public.billing_ingest_stripe_event(text, jsonb) to anon;
