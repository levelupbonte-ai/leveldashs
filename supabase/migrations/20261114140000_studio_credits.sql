-- LevelStudio credits: 60 welcome credits once per account (no longer every
-- day), then paid top-ups. The studio counts what an account used on one
-- lifetime row of studio_usage (day 2000-01-01) and allows 60 + every credit
-- bought. A top-up is paid on a Square payment link opened by the dashboard
-- (/api/studio/credits/checkout, signed-in user); the Square webhook records
-- it and grants the credits.
--
--   studio_credit_order_create(pack)          signed-in user: the pending order
--   studio_credit_order_record(key, id, ...)  dashboard server (billing key)
--   studio_credit_ingest_square(key, event)   Square webhook (billing key)
--   studio_credit_grants_total(user)          LevelStudio server: credits bought

-- @part 1: tables -----------------------------------------------------------------

create table if not exists private.studio_credit_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pack text not null,
  credits integer not null check (credits between 1 and 10000),
  amount integer not null check (amount between 1 and 100000000),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  link_id text check (char_length(link_id) <= 255),
  order_id text unique check (char_length(order_id) <= 255),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists studio_credit_orders_user_idx on private.studio_credit_orders (user_id, created_at desc);

create table if not exists public.studio_credit_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  credits integer not null check (credits between 1 and 10000),
  reason text not null check (reason in ('purchase', 'gift')),
  order_id uuid unique references private.studio_credit_orders (id) on delete set null,
  payment_ref text unique check (char_length(payment_ref) <= 255),
  created_at timestamptz not null default now()
);
create index if not exists studio_credit_grants_user_idx on public.studio_credit_grants (user_id);
alter table public.studio_credit_grants enable row level security;
revoke all on public.studio_credit_grants from public, anon, authenticated;

-- The packs, in one place: 5 USD for 50 credits (10 builds or 25 changes).
create or replace function private.studio_credit_pack(p_pack text)
returns table (credits integer, amount integer, currency text)
language sql
immutable
set search_path = ''
as $$
  select 50, 500, 'usd' where p_pack = 'starter';
$$;

-- @part 2: ordering ---------------------------------------------------------------

create or replace function public.studio_credit_order_create(p_pack text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pack record;
  v_id uuid;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  select * into v_pack from private.studio_credit_pack(p_pack);
  if not found then
    raise exception 'invalid_pack' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('studio_credit_order', auth.uid()::text, 20, interval '1 hour');
  -- An unpaid order of the same pack from the last hour is reused (double click).
  select o.id into v_id from private.studio_credit_orders o
  where o.user_id = auth.uid() and o.pack = p_pack and o.status = 'pending'
    and o.created_at > now() - interval '1 hour'
  order by o.created_at desc limit 1;
  if v_id is null then
    insert into private.studio_credit_orders (user_id, pack, credits, amount, currency)
    values (auth.uid(), p_pack, v_pack.credits, v_pack.amount, v_pack.currency)
    returning id into v_id;
  end if;
  select email into v_email from auth.users where id = auth.uid();
  return (select jsonb_build_object('id', o.id, 'pack', o.pack, 'credits', o.credits, 'amount', o.amount,
      'currency', o.currency, 'link_id', o.link_id, 'email', v_email)
    from private.studio_credit_orders o where o.id = v_id);
end;
$$;

create or replace function public.studio_credit_order_record(p_key text, p_id uuid, p_link_id text, p_order_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_billing_key(p_key);
  if p_link_id !~ '^[A-Za-z0-9_-]{8,255}$' or p_order_id !~ '^[A-Za-z0-9_-]{8,255}$' then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  update private.studio_credit_orders set link_id = p_link_id, order_id = p_order_id
  where id = p_id and status = 'pending';
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
end;
$$;

-- @part 3: paid -> credits ----------------------------------------------------------

create or replace function public.studio_credit_ingest_square(p_key text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order text := p_event ->> 'order_id';
  v_payment text := p_event ->> 'payment_id';
  v_amount bigint := case when jsonb_typeof(p_event -> 'amount') = 'number'
    then (p_event ->> 'amount')::numeric::bigint end;
  v_currency text := lower(nullif(p_event ->> 'currency', ''));
  o private.studio_credit_orders;
begin
  perform private.assert_billing_key(p_key);
  if v_order is null or v_order !~ '^[A-Za-z0-9_-]{8,255}$'
     or v_payment is null or v_payment !~ '^[A-Za-z0-9_-]{8,255}$' then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  select * into o from private.studio_credit_orders where order_id = v_order for update;
  if not found then
    return jsonb_build_object('status', 'unknown_order');
  end if;
  if o.status = 'paid' then
    return jsonb_build_object('status', 'already_paid');
  end if;
  if coalesce(p_event ->> 'payment_status', '') <> 'COMPLETED' then
    return jsonb_build_object('status', 'not_completed');
  end if;
  if v_amount is null or v_amount < o.amount or v_currency is distinct from o.currency then
    perform private.hq_log('studio.credit_payment_mismatch', 'account', o.user_id::text,
      jsonb_build_object('order', o.id, 'amount', v_amount, 'currency', v_currency));
    return jsonb_build_object('status', 'mismatch');
  end if;
  update private.studio_credit_orders set status = 'paid', paid_at = now() where id = o.id;
  insert into public.studio_credit_grants (user_id, credits, reason, order_id, payment_ref)
  values (o.user_id, o.credits, 'purchase', o.id, v_payment)
  on conflict do nothing;
  perform private.hq_log('studio.credits_bought', 'account', o.user_id::text,
    jsonb_build_object('order', o.id, 'credits', o.credits, 'amount', o.amount, 'currency', o.currency));
  return jsonb_build_object('status', 'paid', 'credits', o.credits);
end;
$$;

create or replace function public.studio_credit_grants_total(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(credits), 0)::integer from public.studio_credit_grants where user_id = p_user;
$$;

-- @part 4: grants -------------------------------------------------------------------

revoke all on table private.studio_credit_orders from public, anon, authenticated;
revoke all on function private.studio_credit_pack(text) from public, anon, authenticated;
revoke all on function public.studio_credit_order_create(text), public.studio_credit_order_record(text, uuid, text, text),
  public.studio_credit_ingest_square(text, jsonb), public.studio_credit_grants_total(uuid) from public;
grant execute on function public.studio_credit_order_create(text) to authenticated;
-- The dashboard's server calls (no session) authenticate with the billing key.
grant execute on function public.studio_credit_order_record(text, uuid, text, text),
  public.studio_credit_ingest_square(text, jsonb) to anon, authenticated;
-- LevelStudio's server reads the total like its other credit functions.
grant execute on function public.studio_credit_grants_total(uuid) to service_role;
