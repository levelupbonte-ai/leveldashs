-- Billing: plans with limits, per-organization billing, charges, discounts and
-- upgrade requests. LevelUp sets every price; clients see what they owe and pay
-- outside the app for now (no online payment).
--
-- Every table has RLS. Platform admins read the tables directly; clients never
-- do: they read through public.billing_summary() (members see their plan and
-- usage, owners and admins also see the money). Every write goes through the
-- SECURITY DEFINER functions of 20261026110100_billing_functions.sql, which
-- check the caller (private.assert_platform_admin: LevelUp staff with an aal2
-- session) and write public.hq_audit_log.
--
-- Money is always an integer in minor units (cents) with an ISO 4217 currency
-- in lower case. A plan price of null means "price to be set by LevelUp": it is
-- never shown as a number.

-- @part 1: plans --------------------------------------------------------------

create table public.plans (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 500),
  price_monthly integer check (price_monthly is null or price_monthly between 0 and 100000000),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  -- Known keys only (private.clean_plan_limits); null = unlimited.
  limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  -- Feature keys (translated by the dashboard), ^[a-z][a-z0-9_]{1,39}$.
  features text[] not null default '{}' check (cardinality(features) <= 30),
  sort_order integer not null default 0,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_default or active)
);
create unique index plans_single_default on public.plans ((true)) where is_default;

-- @part 2: one billing row per organization -----------------------------------
-- No row = the default plan, standard price, status active.

create table public.organization_billing (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  plan_key text not null references public.plans (key),
  custom_price integer check (custom_price is null or custom_price between 0 and 100000000),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  billing_note text check (char_length(billing_note) <= 1000),
  next_due_date date,
  status text not null default 'active' check (status in ('active', 'trial', 'past_due', 'suspended')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create index organization_billing_plan_idx on public.organization_billing (plan_key);

-- @part 3: discounts and promo codes ------------------------------------------
-- An organization discount (organization_id set, no code) applies at once, for
-- example label "Partner". A promo code (code set, organization_id null) applies
-- once an owner or admin redeems it; a code bound to one organization
-- (both set) can only be redeemed by that organization. Only the single best
-- discount applies to a charge (never stacked).

create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  code text unique check (code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  label text not null check (char_length(label) between 1 and 60),
  kind text not null check (kind in ('percent', 'fixed')),
  -- percent: 1..100; fixed: minor units in `currency`.
  value integer not null check (value > 0 and value <= 100000000),
  currency text check (currency ~ '^[a-z]{3}$'),
  applies_to text not null default 'all' check (applies_to in ('subscription', 'setup', 'all')),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  max_uses integer check (max_uses is null or max_uses between 1 and 100000),
  uses integer not null default 0 check (uses >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (organization_id is not null or code is not null),
  check (kind <> 'percent' or value <= 100),
  check (kind <> 'fixed' or currency is not null),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index discounts_org_idx on public.discounts (organization_id) where organization_id is not null;

create table public.discount_redemptions (
  discount_id uuid not null references public.discounts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz not null default now(),
  primary key (discount_id, organization_id)
);
create index discount_redemptions_org_idx on public.discount_redemptions (organization_id);

-- @part 4: charges (what the client owes) -------------------------------------
-- amount = base_amount - discount_amount, computed by the database.
-- `overdue` is reported by the read functions for a `due` charge past its due
-- date; the stored status stays `due` until it is paid or voided.

create table public.billing_charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  description text check (char_length(description) <= 1000),
  kind text not null check (kind in ('setup', 'subscription', 'one_off')),
  base_amount integer not null check (base_amount between 0 and 100000000),
  discount_id uuid references public.discounts (id) on delete set null,
  discount_label text check (char_length(discount_label) <= 60),
  discount_amount integer not null default 0 check (discount_amount >= 0),
  amount integer generated always as (base_amount - discount_amount) stored,
  currency text not null check (currency ~ '^[a-z]{3}$'),
  due_date date,
  status text not null default 'due' check (status in ('due', 'paid', 'void', 'overdue')),
  paid_at timestamptz,
  payment_note text check (char_length(payment_note) <= 300),
  void_reason text check (char_length(void_reason) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount_amount <= base_amount),
  check ((status = 'paid') = (paid_at is not null))
);
create index billing_charges_org_idx on public.billing_charges (organization_id, created_at desc);

-- @part 5: upgrade requests ---------------------------------------------------
-- An owner or admin asks for another plan from Billing. Not a payment: LevelUp
-- staff approve (the plan changes) or decline it.

create table public.plan_upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  plan_key text not null references public.plans (key),
  from_plan_key text references public.plans (key),
  message text check (char_length(message) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text check (char_length(decision_note) <= 500)
);
create unique index plan_upgrade_requests_one_pending
  on public.plan_upgrade_requests (organization_id) where status = 'pending';
create index plan_upgrade_requests_status_idx on public.plan_upgrade_requests (status, created_at desc);

-- @part 6: RLS, grants, triggers ----------------------------------------------

alter table public.plans enable row level security;
alter table public.organization_billing enable row level security;
alter table public.discounts enable row level security;
alter table public.discount_redemptions enable row level security;
alter table public.billing_charges enable row level security;
alter table public.plan_upgrade_requests enable row level security;

do $$
declare t text;
begin
  foreach t in array array['plans', 'organization_billing', 'discounts', 'discount_redemptions',
                           'billing_charges', 'plan_upgrade_requests'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_platform_admin()))',
      t || '_staff_read', t);
  end loop;
end;
$$;

create trigger plans_set_updated_at before update on public.plans
  for each row execute function private.set_updated_at();
create trigger organization_billing_set_updated_at before update on public.organization_billing
  for each row execute function private.set_updated_at();
create trigger discounts_set_updated_at before update on public.discounts
  for each row execute function private.set_updated_at();
create trigger billing_charges_set_updated_at before update on public.billing_charges
  for each row execute function private.set_updated_at();

-- @part 7: seed ---------------------------------------------------------------
-- Free is the default. Paid plan prices are left for LevelUp to set (null =
-- "price to be set"): no made-up number is ever shown to a client.

insert into public.plans (key, name, price_monthly, currency, limits, features, sort_order, is_default) values
  ('free', 'Free', 0, 'usd',
   '{"team_members": 2, "assistant_requests_month": 50, "media_mb": 500, "websites": 1}',
   array['website_hosting', 'analytics', 'forms_inbox', 'ai_assistant'], 0, true),
  ('starter', 'Starter', null, 'usd',
   '{"team_members": 5, "assistant_requests_month": 200, "media_mb": 2048, "websites": 1}',
   array['website_hosting', 'analytics', 'forms_inbox', 'ai_assistant', 'custom_domain', 'email_support'], 10, false),
  ('pro', 'Pro', null, 'usd',
   '{"team_members": 15, "assistant_requests_month": 600, "media_mb": 10240, "websites": 3}',
   array['website_hosting', 'analytics', 'forms_inbox', 'ai_assistant', 'custom_domain', 'payments', 'bookings', 'seo_tools', 'priority_support'], 20, false),
  ('business', 'Business', null, 'usd',
   '{"team_members": null, "assistant_requests_month": 1500, "media_mb": 51200, "websites": 10}',
   array['website_hosting', 'analytics', 'forms_inbox', 'ai_assistant', 'custom_domain', 'payments', 'bookings', 'seo_tools', 'priority_support', 'dedicated_manager'], 30, false)
on conflict (key) do nothing;

-- LevelUp's own organization runs two websites: Business, no price.
insert into public.organization_billing (organization_id, plan_key, billing_note)
select o.id, 'business', null from public.organizations o where o.slug = 'levelup-ecosystem'
on conflict (organization_id) do nothing;
