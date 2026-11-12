-- Client portal: membership vs monthly plans.
--
-- Joining (the one-time payment) makes someone a member. Receiving the
-- owner's information is a separate thing: every new member gets a free offer
-- (trial_days, 3 by default, chosen by the owner), then needs one of up to
-- three monthly plans (name, price and content chosen by the owner).
--
-- * portal_settings       free offer length and level, contact details shown
--                         only to signed-in members (never on the public site)
-- * portal_plans          one plan per level (1..3)
-- * portal_subscriptions  one row per provider subscription (Stripe)
-- * portal_items.min_level  0 = every member, 1..3 = that plan level or above
-- * members can cancel, resume, pay again and delete their account
-- * load: sign-in code cap per site raised, cheaper password hashing, an
--   index for the payments lookup, old rate-limit rows pruned

-- ------------------------------------------------------------ tables

create table if not exists public.portal_settings (
  website_id text primary key,
  organization_id uuid not null,
  trial_days smallint not null default 3 check (trial_days between 0 and 60),
  trial_level smallint not null default 1 check (trial_level between 1 and 3),
  contact jsonb not null default '{}'::jsonb
    check (jsonb_typeof(contact) = 'object' and pg_column_size(contact) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);
alter table public.portal_settings enable row level security;
revoke all on public.portal_settings from public, anon, authenticated;

create table if not exists public.portal_plans (
  id uuid primary key default gen_random_uuid(),
  website_id text not null,
  organization_id uuid not null,
  level smallint not null check (level between 1 and 3),
  name text not null check (char_length(name) between 1 and 60),
  description text check (description is null or char_length(description) <= 300),
  features jsonb not null default '[]'::jsonb
    check (jsonb_typeof(features) = 'array' and jsonb_array_length(features) <= 8),
  amount integer not null check (amount between 100 and 10000000),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (website_id, level),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);
alter table public.portal_plans enable row level security;
revoke all on public.portal_plans from public, anon, authenticated;

create table if not exists public.portal_subscriptions (
  id uuid primary key default gen_random_uuid(),
  website_id text not null,
  organization_id uuid not null,
  customer_id uuid not null,
  plan_id uuid references public.portal_plans (id) on delete set null,
  plan_name text not null,
  level smallint not null check (level between 1 and 3),
  amount integer not null,
  currency text not null,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_subscription_id text not null check (char_length(provider_subscription_id) between 5 and 120),
  provider_customer_id text check (provider_customer_id is null or char_length(provider_customer_id) <= 120),
  status text not null check (status in ('active', 'past_due', 'canceled', 'incomplete')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id),
  foreign key (customer_id, website_id) references public.portal_customers (id, website_id) on delete cascade
);
create index if not exists portal_subscriptions_customer_idx on public.portal_subscriptions (customer_id, status);
alter table public.portal_subscriptions enable row level security;
revoke all on public.portal_subscriptions from public, anon, authenticated;

alter table public.portal_customers add column if not exists trial_ends_at timestamptz;
alter table public.portal_customers add column if not exists deleted_at timestamptz;
alter table public.portal_items add column if not exists min_level smallint not null default 0
  check (min_level between 0 and 3);

-- Customers can be 'deleted' (account removed by its owner) and codes can be
-- for 'delete'.
do $do$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as rel from pg_constraint c
    where c.contype = 'c'
      and ((c.conrelid = 'public.portal_customers'::regclass and pg_get_constraintdef(c.oid) like '%status = ANY%')
        or (c.conrelid = 'private.portal_codes'::regclass and pg_get_constraintdef(c.oid) like '%purpose = ANY%'))
  loop
    execute format('alter table %s drop constraint %I', r.rel, r.conname);
  end loop;
end;
$do$;
alter table public.portal_customers add constraint portal_customers_status_check
  check (status in ('active', 'revoked', 'deleted'));
alter table private.portal_codes add constraint portal_codes_purpose_check
  check (purpose in ('sign_in', 'password', 'email_old', 'email_new', 'delete'));

-- Load: the member's payments are looked up by e-mail on every page.
create index if not exists site_payments_site_email_idx
  on public.site_payments (website_id, lower(customer_email)) where customer_email is not null;

-- ------------------------------------------------------------ free offer

create or replace function private.portal_customer_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.trial_ends_at is null then
    new.trial_ends_at := now() + make_interval(days => coalesce(
      (select s.trial_days from public.portal_settings s where s.website_id = new.website_id), 3));
  end if;
  return new;
end;
$$;
drop trigger if exists portal_customer_trial on public.portal_customers;
create trigger portal_customer_trial before insert on public.portal_customers
  for each row execute function private.portal_customer_trial();

-- Members who joined before this feature get the offer from now.
update public.portal_customers set trial_ends_at = now() + interval '3 days' where trial_ends_at is null;

/** What a member may read: the best of their plan (2 days of grace when a payment is late) and the free offer. */
create or replace function private.portal_customer_level(p_customer_id uuid)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((select max(s.level) from public.portal_subscriptions s
              where s.customer_id = p_customer_id and s.status in ('active', 'past_due')
                and (s.current_period_end is null or s.current_period_end > now() - interval '2 days')), 0),
    coalesce((select coalesce(st.trial_level, 1)
              from public.portal_customers c
              left join public.portal_settings st on st.website_id = c.website_id
              where c.id = p_customer_id and c.trial_ends_at > now()), 0)
  )::smallint;
$$;
revoke all on function private.portal_customer_level(uuid) from public, anon, authenticated;

create or replace function private.portal_item_visible(p_item public.portal_items, p_customer_id uuid, p_offers text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_item.status = 'published'
    and (p_item.audience = 'all'
      or (p_item.audience = 'customer' and p_item.customer_id = p_customer_id)
      or (p_item.audience = 'offer' and p_item.offer_id = any (p_offers)))
    and (p_item.min_level = 0 or p_item.min_level <= private.portal_customer_level(p_customer_id));
$$;

/** The member's latest subscription as the portal and the dashboard show it. */
create or replace function private.portal_subscription_json(p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'plan_name', s.plan_name, 'level', s.level, 'amount', s.amount, 'currency', s.currency,
    'status', s.status, 'current_period_end', s.current_period_end,
    'cancel_at_period_end', s.cancel_at_period_end, 'canceled_at', s.canceled_at)
  from public.portal_subscriptions s
  where s.customer_id = p_customer_id and s.status <> 'incomplete'
  order by (s.status in ('active', 'past_due')) desc, s.updated_at desc
  limit 1;
$$;
revoke all on function private.portal_subscription_json(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ member: home

create or replace function public.portal_home(p_key text, p_session text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; v_offers text[]; v jsonb; v_level smallint; st public.portal_settings;
begin
  c := private.portal_session(p_key, p_session);
  v_offers := private.portal_customer_offers(c.id);
  v_level := private.portal_customer_level(c.id);
  select * into st from public.portal_settings where website_id = c.website_id;
  select jsonb_build_object(
    'customer', jsonb_build_object(
      'name', c.name, 'email', c.email, 'locale', c.locale, 'since', c.created_at,
      'has_password', exists (select 1 from private.portal_passwords where customer_id = c.id),
      'sessions', (select count(*) from private.portal_sessions
                   where customer_id = c.id and revoked_at is null and expires_at > now())),
    'offers', to_jsonb(v_offers),
    'access', jsonb_build_object(
      'level', v_level,
      'trial_ends_at', c.trial_ends_at,
      'trial_active', c.trial_ends_at is not null and c.trial_ends_at > now(),
      'trial_days', coalesce(st.trial_days, 3),
      'subscription', private.portal_subscription_json(c.id)),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object('level', p.level, 'name', p.name, 'description', p.description,
                                          'features', p.features, 'amount', p.amount, 'currency', p.currency)
                       order by p.level)
      from public.portal_plans p where p.website_id = c.website_id and p.active), '[]'::jsonb),
    -- Contact details are for members only: they are never on the public site.
    'contact', coalesce(st.contact, '{}'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'offer_id', p.offer_id, 'offer_name', p.offer_name, 'status', p.status,
        'amount', p.amount, 'currency', p.currency, 'paid_at', p.paid_at,
        'refunded_at', p.refunded_at, 'occurred_at', p.occurred_at,
        'amount_refunded', case when p.metadata ->> 'amount_refunded' ~ '^[0-9]{1,12}$'
                                then (p.metadata ->> 'amount_refunded')::bigint end,
        'refund', case when p.metadata ->> 'refund' in ('full', 'partial') then p.metadata ->> 'refund' end,
        'receipt', p.provider = 'stripe' and p.provider_payment_intent is not null)
        order by coalesce(p.paid_at, p.occurred_at) desc)
      from public.site_payments p
      where p.website_id = c.website_id
        and lower(p.customer_email) = any (c.payment_emails || c.email)
        and p.status in ('paid', 'refunded')), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'title', i.title, 'body', i.body, 'trip', i.trip,
        'checklist', i.checklist, 'published_at', i.published_at, 'min_level', i.min_level,
        'document', case when i.kind = 'document' then jsonb_build_object(
          'name', i.document_name, 'size', i.document_size, 'type', i.document_type) end,
        'read', s.read_at is not null,
        'checked', coalesce(to_jsonb(s.checked), '[]'::jsonb))
        order by i.published_at desc)
      from (select * from public.portal_items i0
            where i0.website_id = c.website_id and private.portal_item_visible(i0, c.id, v_offers)
            order by i0.published_at desc limit 200) i
      left join public.portal_item_states s on s.item_id = i.id and s.customer_id = c.id), '[]'::jsonb),
    -- Information the member's plan does not include: the title only.
    'locked', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'title', l.title,
                                          'published_at', l.published_at, 'min_level', l.min_level)
                       order by l.published_at desc)
      from (select i.id, i.kind, i.title, i.published_at, i.min_level
            from public.portal_items i
            where i.website_id = c.website_id and i.status = 'published' and i.min_level > v_level
              and (i.audience = 'all'
                or (i.audience = 'customer' and i.customer_id = c.id)
                or (i.audience = 'offer' and i.offer_id = any (v_offers)))
            order by i.published_at desc limit 20) l), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body,
                                          'created_at', m.created_at,
                                          'read', m.sender = 'customer' or m.read_at is not null,
                                          'seen', m.sender = 'customer' and m.read_at is not null)
                       order by m.created_at)
      from (select * from public.portal_messages where customer_id = c.id
            order by created_at desc limit 200) m), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.portal_home(text, text) from public;
grant execute on function public.portal_home(text, text) to anon, authenticated;

-- New messages only (the conversation refreshes itself without reloading everything).
create or replace function public.portal_messages_since(p_key text, p_session text, p_after timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  return jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body,
                                          'created_at', m.created_at,
                                          'read', m.sender = 'customer' or m.read_at is not null,
                                          'seen', m.sender = 'customer' and m.read_at is not null)
                       order by m.created_at)
      from (select * from public.portal_messages
            where customer_id = c.id and created_at > coalesce(p_after, 'epoch'::timestamptz)
            order by created_at limit 100) m), '[]'::jsonb),
    -- Ids of the member's own messages the team has read.
    'seen', coalesce((
      select jsonb_agg(m.id) from public.portal_messages m
      where m.customer_id = c.id and m.sender = 'customer' and m.read_at is not null
        and m.created_at > now() - interval '30 days'), '[]'::jsonb));
end;
$$;
revoke all on function public.portal_messages_since(text, text, timestamptz) from public;
grant execute on function public.portal_messages_since(text, text, timestamptz) to anon, authenticated;

-- ------------------------------------------------------------ member: plans

-- What the site's server needs to open a payment page for a plan.
create or replace function public.portal_subscribe_start(p_key text, p_session text, p_level integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; p public.portal_plans; s public.portal_subscriptions;
begin
  c := private.portal_session(p_key, p_session);
  perform private.hit_rate_limit('portal_subscribe', c.id::text, 10, interval '1 hour');
  select * into p from public.portal_plans
  where website_id = c.website_id and level = p_level and active;
  if p.id is null then
    raise exception 'Unknown plan' using errcode = 'PT404';
  end if;
  select * into s from public.portal_subscriptions
  where customer_id = c.id and status in ('active', 'past_due')
  order by updated_at desc limit 1;
  return jsonb_build_object(
    'customer_id', c.id, 'email', c.email, 'name', c.name, 'locale', c.locale,
    'plan', jsonb_build_object('id', p.id, 'level', p.level, 'name', p.name, 'description', p.description,
                               'amount', p.amount, 'currency', p.currency),
    'current', case when s.id is not null then jsonb_build_object(
      'provider_subscription_id', s.provider_subscription_id, 'level', s.level,
      'cancel_at_period_end', s.cancel_at_period_end) end,
    'provider_customer_id', (select x.provider_customer_id from public.portal_subscriptions x
                             where x.customer_id = c.id and x.provider_customer_id is not null
                             order by x.updated_at desc limit 1));
end;
$$;
revoke all on function public.portal_subscribe_start(text, text, integer) from public;
grant execute on function public.portal_subscribe_start(text, text, integer) to anon, authenticated;

-- The member's subscriptions at the provider (to cancel, resume or refresh them).
create or replace function public.portal_subscription_refs(p_key text, p_session text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  return coalesce((
    select jsonb_agg(jsonb_build_object('provider_subscription_id', s.provider_subscription_id,
                                        'status', s.status, 'cancel_at_period_end', s.cancel_at_period_end,
                                        'current_period_end', s.current_period_end)
                     order by s.updated_at desc)
    from public.portal_subscriptions s
    where s.customer_id = c.id and s.status in ('active', 'past_due', 'incomplete')), '[]'::jsonb);
end;
$$;
revoke all on function public.portal_subscription_refs(text, text) from public;
grant execute on function public.portal_subscription_refs(text, text) to anon, authenticated;

-- State of a subscription as the provider reports it (called by the site's
-- server after a payment page, a webhook, a cancel). The portal key
-- authenticates the call; the member and the plan must belong to its website.
create or replace function public.portal_subscription_sync(p_key text, p_sub jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text; v_org uuid; v_sid text; v_customer uuid; v_plan uuid; v_status text;
  c public.portal_customers; p public.portal_plans; v_end timestamptz;
begin
  select website_id, organization_id into v_site, v_org from private.portal_key_website(p_key);
  if p_sub is null or jsonb_typeof(p_sub) <> 'object' then
    raise exception 'Invalid subscription' using errcode = '22023';
  end if;
  v_sid := p_sub ->> 'subscription_id';
  if v_sid is null or v_sid !~ '^sub_[A-Za-z0-9]{5,100}$' then
    raise exception 'Invalid subscription' using errcode = '22023';
  end if;
  v_status := case p_sub ->> 'status'
    when 'active' then 'active' when 'trialing' then 'active'
    when 'past_due' then 'past_due' when 'unpaid' then 'past_due'
    when 'canceled' then 'canceled' when 'incomplete_expired' then 'canceled'
    when 'incomplete' then 'incomplete' when 'paused' then 'canceled'
    else null end;
  if v_status is null then
    raise exception 'Invalid subscription status' using errcode = '22023';
  end if;
  if (p_sub ->> 'current_period_end') ~ '^[0-9]{9,11}$' then
    v_end := to_timestamp((p_sub ->> 'current_period_end')::bigint);
  end if;

  -- Known subscription: only its state changes.
  update public.portal_subscriptions s
     set status = v_status,
         current_period_end = coalesce(v_end, s.current_period_end),
         cancel_at_period_end = coalesce((p_sub ->> 'cancel_at_period_end')::boolean, false),
         canceled_at = case when v_status = 'canceled' then coalesce(s.canceled_at, now()) else null end,
         provider_customer_id = coalesce(left(p_sub ->> 'provider_customer_id', 120), s.provider_customer_id),
         updated_at = now()
   where s.provider = 'stripe' and s.provider_subscription_id = v_sid and s.website_id = v_site;
  if found then
    return jsonb_build_object('ok', true, 'created', false);
  end if;

  if coalesce(p_sub ->> 'customer_id', '') !~ '^[0-9a-f-]{36}$' or coalesce(p_sub ->> 'plan_id', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'Unknown subscription' using errcode = 'PT404';
  end if;
  v_customer := (p_sub ->> 'customer_id')::uuid;
  v_plan := (p_sub ->> 'plan_id')::uuid;
  select * into c from public.portal_customers where id = v_customer and website_id = v_site;
  select * into p from public.portal_plans where id = v_plan and website_id = v_site;
  if c.id is null or p.id is null then
    raise exception 'Unknown subscription' using errcode = 'PT404';
  end if;
  insert into public.portal_subscriptions (website_id, organization_id, customer_id, plan_id, plan_name, level,
                                           amount, currency, provider_subscription_id, provider_customer_id,
                                           status, current_period_end, cancel_at_period_end, canceled_at)
  values (v_site, v_org, c.id, p.id, p.name, p.level, p.amount, p.currency, v_sid,
          left(p_sub ->> 'provider_customer_id', 120), v_status, v_end,
          coalesce((p_sub ->> 'cancel_at_period_end')::boolean, false),
          case when v_status = 'canceled' then now() end)
  on conflict (provider, provider_subscription_id) do nothing;
  perform private.site_audit(v_site, v_org, 'portal.subscription_started', c.id::text,
    jsonb_build_object('label', p.name, 'level', p.level));
  return jsonb_build_object('ok', true, 'created', true);
end;
$$;
revoke all on function public.portal_subscription_sync(text, jsonb) from public;
grant execute on function public.portal_subscription_sync(text, jsonb) to anon, authenticated;

-- ------------------------------------------------------------ member: delete the account

-- Step 1: the e-mailed code is checked; the account is marked for deletion and
-- the provider subscriptions to stop are returned to the site's server.
create or replace function public.portal_delete_account_begin(p_key text, p_session text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  perform private.hit_rate_limit('portal_delete', c.id::text, 10, interval '1 hour');
  if not private.portal_check_code(c.id, 'delete', p_code) then
    return jsonb_build_object('ok', false);
  end if;
  update public.portal_customers set deleted_at = now() where id = c.id;
  return jsonb_build_object('ok', true, 'subscriptions', coalesce((
    select jsonb_agg(s.provider_subscription_id) from public.portal_subscriptions s
    where s.customer_id = c.id and s.status in ('active', 'past_due', 'incomplete')), '[]'::jsonb));
end;
$$;
revoke all on function public.portal_delete_account_begin(text, text, text) from public;
grant execute on function public.portal_delete_account_begin(text, text, text) to anon, authenticated;

-- Step 2 (within 15 minutes, once the subscriptions are stopped): the account
-- is closed and its personal data removed. Payment records stay, as accounting
-- rules require, but are no longer linked to an account.
create or replace function public.portal_delete_account_finish(p_key text, p_session text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  if c.deleted_at is null or c.deleted_at < now() - interval '15 minutes' then
    raise exception 'Confirm the deletion first' using errcode = '22023';
  end if;
  delete from private.portal_passwords where customer_id = c.id;
  delete from private.portal_codes where customer_id = c.id;
  delete from private.portal_outbox where customer_id = c.id;
  delete from public.portal_messages where customer_id = c.id;
  delete from public.portal_item_states where customer_id = c.id;
  delete from public.portal_items where customer_id = c.id;
  update private.portal_sessions set revoked_at = now() where customer_id = c.id and revoked_at is null;
  update public.portal_subscriptions set status = 'canceled', canceled_at = coalesce(canceled_at, now()), updated_at = now()
   where customer_id = c.id and status <> 'canceled';
  update public.portal_customers
     set status = 'deleted', deleted_at = now(), name = null, payment_emails = '{}',
         email = 'deleted-' || c.id::text || '@deleted.invalid', offer_id = null, updated_at = now()
   where id = c.id;
  perform private.site_audit(c.website_id, c.organization_id, 'portal.account_deleted', c.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.portal_delete_account_finish(text, text) from public;
grant execute on function public.portal_delete_account_finish(text, text) to anon, authenticated;

-- Codes for the deletion are sent like the password ones (signed-in member);
-- thousands of members may ask for a sign-in code in the same hour.
do $do$
declare
  d text := pg_get_functiondef('public.portal_request_code(text,text,text,text,text,text)'::regprocedure);
begin
  if position($a$if p_purpose in ('password', 'delete') then$a$ in d) = 0 then
    if position($a$if p_purpose = 'password' then$a$ in d) = 0
       or position($a$private.hit_rate_limit('portal_code_site', v_site, 300, interval '1 hour')$a$ in d) = 0 then
      raise exception 'portal_request_code: unexpected body, not patched';
    end if;
    d := replace(d, $a$if p_purpose = 'password' then$a$, $a$if p_purpose in ('password', 'delete') then$a$);
    d := replace(d, $a$private.hit_rate_limit('portal_code_site', v_site, 300, interval '1 hour')$a$,
                    $a$private.hit_rate_limit('portal_code_site', v_site, 6000, interval '1 hour')$a$);
    execute d;
  end if;
end;
$do$;

-- Password hashing: cost 10 (the usual minimum) instead of 12, four times
-- lighter on the database when many members sign in at once.
do $do$
declare
  d text := pg_get_functiondef('public.portal_set_password(text,text,text,text)'::regprocedure);
begin
  if position($a$gen_salt('bf', 12)$a$ in d) > 0 then
    execute replace(d, $a$gen_salt('bf', 12)$a$, $a$gen_salt('bf', 10)$a$);
  end if;
end;
$do$;

-- ------------------------------------------------------------ owner (dashboard)

create or replace function public.portal_admin_settings(p_website_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid; st public.portal_settings;
begin
  v_org := private.portal_manage_site(p_website_id);
  select * into st from public.portal_settings where website_id = p_website_id;
  return jsonb_build_object(
    'trial_days', coalesce(st.trial_days, 3),
    'trial_level', coalesce(st.trial_level, 1),
    'contact', coalesce(st.contact, '{}'::jsonb),
    'can_admin', private.has_org_role(v_org, 'admin'),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'level', p.level, 'name', p.name,
                                          'description', p.description, 'features', p.features,
                                          'amount', p.amount, 'currency', p.currency, 'active', p.active,
                                          'subscribers', (select count(*) from public.portal_subscriptions s
                                                          where s.plan_id = p.id and s.status in ('active', 'past_due')))
                       order by p.level)
      from public.portal_plans p where p.website_id = p_website_id), '[]'::jsonb));
end;
$$;
revoke all on function public.portal_admin_settings(text) from public, anon;
grant execute on function public.portal_admin_settings(text) to authenticated;

create or replace function public.portal_admin_save_settings(
  p_website_id text, p_trial_days integer, p_trial_level integer, p_contact jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_phone text; v_whatsapp text; v_note text; v_contact jsonb;
begin
  v_org := private.portal_manage_site(p_website_id);
  if not private.has_org_role(v_org, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_trial_days is null or p_trial_days not between 0 and 60
     or p_trial_level is null or p_trial_level not between 1 and 3 then
    raise exception 'Invalid offer' using errcode = '22023';
  end if;
  if p_contact is not null and jsonb_typeof(p_contact) <> 'object' then
    raise exception 'Invalid contact' using errcode = '22023';
  end if;
  v_phone := private.check_text(p_contact ->> 'phone', 40, 'phone');
  v_whatsapp := private.check_text(p_contact ->> 'whatsapp', 40, 'whatsapp');
  v_note := private.check_text(p_contact ->> 'note', 300, 'note', true);
  if (v_phone is not null and not private.is_valid_phone(v_phone))
     or (v_whatsapp is not null and not private.is_valid_phone(v_whatsapp)) then
    raise exception 'Invalid phone number' using errcode = '22023';
  end if;
  v_contact := jsonb_strip_nulls(jsonb_build_object('phone', v_phone, 'whatsapp', v_whatsapp, 'note', v_note));
  insert into public.portal_settings (website_id, organization_id, trial_days, trial_level, contact, updated_by)
  values (p_website_id, v_org, p_trial_days, p_trial_level, v_contact, (select auth.uid()))
  on conflict (website_id) do update
    set trial_days = excluded.trial_days, trial_level = excluded.trial_level, contact = excluded.contact,
        updated_at = now(), updated_by = excluded.updated_by;
  perform private.site_audit(p_website_id, v_org, 'portal.settings_updated', p_website_id,
    jsonb_build_object('trial_days', p_trial_days));
end;
$$;
revoke all on function public.portal_admin_save_settings(text, integer, integer, jsonb) from public, anon;
grant execute on function public.portal_admin_save_settings(text, integer, integer, jsonb) to authenticated;

-- One plan per level. Members already subscribed keep the price they signed up at.
create or replace function public.portal_admin_save_plan(
  p_website_id text, p_level integer, p_name text, p_description text, p_features jsonb,
  p_amount integer, p_currency text, p_active boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_id uuid; v_name text; v_features jsonb := '[]'::jsonb; f jsonb; v_line text;
begin
  v_org := private.portal_manage_site(p_website_id);
  if not private.has_org_role(v_org, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_name := private.check_text(p_name, 60, 'name');
  if p_level is null or p_level not between 1 and 3 or v_name is null
     or p_amount is null or p_amount not between 100 and 10000000
     or coalesce(p_currency, '') !~ '^[a-z]{3}$' then
    raise exception 'Invalid plan' using errcode = '22023';
  end if;
  if p_features is not null then
    if jsonb_typeof(p_features) <> 'array' or jsonb_array_length(p_features) > 8 then
      raise exception 'Invalid plan: features' using errcode = '22023';
    end if;
    for f in select * from jsonb_array_elements(p_features) loop
      v_line := case when jsonb_typeof(f) = 'string' then private.check_text(f #>> '{}', 120, 'feature') end;
      if v_line is not null then
        v_features := v_features || to_jsonb(v_line);
      end if;
    end loop;
  end if;
  insert into public.portal_plans (website_id, organization_id, level, name, description, features, amount,
                                   currency, active, updated_by)
  values (p_website_id, v_org, p_level, v_name, private.check_text(p_description, 300, 'description', true),
          v_features, p_amount, p_currency, coalesce(p_active, true), (select auth.uid()))
  on conflict (website_id, level) do update
    set name = excluded.name, description = excluded.description, features = excluded.features,
        amount = excluded.amount, currency = excluded.currency, active = excluded.active,
        updated_at = now(), updated_by = excluded.updated_by
  returning id into v_id;
  perform private.site_audit(p_website_id, v_org, 'portal.plan_saved', v_id::text,
    jsonb_build_object('label', v_name, 'level', p_level, 'amount', p_amount, 'active', coalesce(p_active, true)));
  return v_id;
end;
$$;
revoke all on function public.portal_admin_save_plan(text, integer, text, text, jsonb, integer, text, boolean) from public, anon;
grant execute on function public.portal_admin_save_plan(text, integer, text, text, jsonb, integer, text, boolean) to authenticated;

-- The owner can move the end of one member's free offer (up to 90 days ahead, or end it now).
create or replace function public.portal_admin_set_trial(p_customer_id uuid, p_ends_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; v_org uuid;
begin
  select * into c from public.portal_customers where id = p_customer_id and status <> 'deleted';
  if c.id is null then
    raise exception 'Unknown customer' using errcode = 'PT404';
  end if;
  v_org := private.portal_manage_site(c.website_id);
  if p_ends_at is null or p_ends_at > now() + interval '90 days' then
    raise exception 'Invalid date' using errcode = '22023';
  end if;
  update public.portal_customers set trial_ends_at = p_ends_at, updated_at = now() where id = c.id;
  perform private.site_audit(c.website_id, v_org, 'portal.trial_changed', c.id::text,
    jsonb_build_object('ends_at', p_ends_at));
end;
$$;
revoke all on function public.portal_admin_set_trial(uuid, timestamptz) from public, anon;
grant execute on function public.portal_admin_set_trial(uuid, timestamptz) to authenticated;

-- Publishing: an information can be reserved to a plan level; only members who
-- can read it are notified.
do $do$
declare
  d text := pg_get_functiondef('public.portal_admin_publish(text,jsonb,boolean)'::regprocedure);
  a1 text := $a$v_id uuid; v_queued integer := 0;$a$;
  a2 text := $a$v_body := private.check_text(p_item ->> 'body', 8000, 'body', true);$a$;
  a3 text := $a$document_type, created_by)$a$;
  a4 text := $a$v_doc_name, v_size, v_type, (select auth.uid()))$a$;
  a5 text := $a$and (v_aud = 'all' or (v_aud = 'customer' and c.id = v_customer)$a$;
begin
  if position('v_min' in d) > 0 then
    return;
  end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0
     or position(a4 in d) = 0 or position(a5 in d) = 0 then
    raise exception 'portal_admin_publish: unexpected body, not patched';
  end if;
  d := replace(d, a1, a1 || ' v_min smallint := 0;');
  d := replace(d, a2, a2 || $ins$
  if p_item ->> 'min_level' is not null then
    if p_item ->> 'min_level' !~ '^[0-3]$' then
      raise exception 'Invalid item: level' using errcode = '22023';
    end if;
    v_min := (p_item ->> 'min_level')::smallint;
  end if;$ins$);
  d := replace(d, a3, 'document_type, created_by, min_level)');
  d := replace(d, a4, 'v_doc_name, v_size, v_type, (select auth.uid()), v_min)');
  d := replace(d, a5, $ins$and (v_min = 0 or private.portal_customer_level(c.id) >= v_min)
      $ins$ || a5);
  execute d;
end;
$do$;

-- Overview: each member's free offer and plan, each information's level; closed accounts are left out.
do $do$
declare
  d text := pg_get_functiondef('public.portal_admin_overview(text)'::regprocedure);
  a1 text := $a$'last_sign_in_at', c.last_sign_in_at,$a$;
  a2 text := $a$'offer_id', i.offer_id, 'title', i.title,$a$;
  a3 text := $a$from public.portal_customers c where c.website_id = p_website_id), '[]'::jsonb),$a$;
begin
  if position('trial_ends_at' in d) > 0 then
    return;
  end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
    raise exception 'portal_admin_overview: unexpected body, not patched';
  end if;
  d := replace(d, a1, a1 || $ins$
        'trial_ends_at', c.trial_ends_at, 'level', private.portal_customer_level(c.id),
        'subscription', private.portal_subscription_json(c.id),$ins$);
  d := replace(d, a2, a2 || $ins$ 'min_level', i.min_level,$ins$);
  d := replace(d, a3, $ins$from public.portal_customers c where c.website_id = p_website_id and c.status <> 'deleted'), '[]'::jsonb),$ins$);
  execute d;
end;
$do$;

-- Old rate-limit rows are useless after a few days: the security watch removes them.
do $do$
declare
  d text := pg_get_functiondef('private.security_scan()'::regprocedure);
  anchor text := $a$  delete from private.security_alerts where created_at < now() - interval '180 days';$a$;
begin
  if position('rate_limit_events where created_at' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'security_scan: unexpected body, not patched';
  end if;
  execute replace(d, anchor, $ins$  delete from private.rate_limit_events where created_at < now() - interval '3 days';
$ins$ || anchor);
end;
$do$;
