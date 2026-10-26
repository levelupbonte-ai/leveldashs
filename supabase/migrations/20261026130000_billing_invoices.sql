-- Invoices and receipts for billing charges (tables in 20261026110000_billing_schema.sql,
-- functions in 20261026110100_billing_functions.sql).
--
-- * One staff-editable issuer row (`public.billing_issuers`, key `levelup`): legal name,
--   address, e-mail, optional tax / registration number. Seeded EMPTY on purpose: LevelUp
--   fills it on the admin Billing screen. Until legal name, address and e-mail are set,
--   staff see a warning and clients cannot download documents.
-- * Every charge gets an invoice number when it is issued (inserted), sequential and
--   gap-free per issuer and calendar year (America/Toronto): `LU-2026-0001`. The counter
--   row is locked `for update` inside the inserting transaction, so a refused charge
--   rolls its number back and two staff never get the same number. Numbers never
--   change; a voided charge keeps its number (the document shows "Void").
-- * Staff record the payment method (cash / bank transfer / mobile money / card /
--   other), the paid date and an optional reference: that produces the receipt.
-- * `billing_charge_document(id)`: everything the invoice / receipt PDF shows, for owners
--   and admins of the charge's organization (and LevelUp staff on aal2). Anyone else
--   gets `charge_not_found` (nothing to probe).
--
-- Only additive statements: create ... if not exists, add column if not exists,
-- create or replace.

-- @part 1: issuer ------------------------------------------------------------------

create table if not exists public.billing_issuers (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  invoice_prefix text not null check (invoice_prefix ~ '^[A-Z]{2,6}$'),
  legal_name text check (char_length(legal_name) <= 200),
  address text check (char_length(address) <= 500),
  email text check (email is null or char_length(email) <= 254),
  tax_id text check (char_length(tax_id) <= 80),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.billing_issuers enable row level security;
revoke all on table public.billing_issuers from public, anon, authenticated;
grant select on table public.billing_issuers to authenticated;
drop policy if exists billing_issuers_staff_read on public.billing_issuers;
create policy billing_issuers_staff_read on public.billing_issuers
  for select to authenticated using ((select private.is_platform_admin()));

drop trigger if exists billing_issuers_set_updated_at on public.billing_issuers;
create trigger billing_issuers_set_updated_at before update on public.billing_issuers
  for each row execute function private.set_updated_at();

-- No business details are invented: only the key and the number prefix.
insert into public.billing_issuers (key, invoice_prefix) values ('levelup', 'LU')
on conflict (key) do nothing;

-- One counter per issuer and year. Server-only (no API role can read or write it).
create table if not exists private.invoice_counters (
  issuer_key text not null references public.billing_issuers (key),
  year integer not null check (year between 2000 and 2999),
  last_number integer not null default 0 check (last_number >= 0),
  primary key (issuer_key, year)
);
alter table private.invoice_counters enable row level security;
revoke all on table private.invoice_counters from public, anon, authenticated;

-- @part 2: charge columns ------------------------------------------------------------

alter table public.billing_charges
  add column if not exists issuer_key text references public.billing_issuers (key),
  add column if not exists invoice_number text,
  add column if not exists issued_on date,
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('cash', 'bank_transfer', 'mobile_money', 'card', 'other')),
  add column if not exists payment_reference text check (char_length(payment_reference) <= 255),
  add column if not exists payment_provider text check (payment_provider is null or payment_provider in ('stripe')),
  add column if not exists provider_session_id text check (char_length(provider_session_id) <= 255),
  add column if not exists paid_amount integer check (paid_amount is null or paid_amount >= 0);

create unique index if not exists billing_charges_invoice_number_key
  on public.billing_charges (invoice_number);
create unique index if not exists billing_charges_provider_session_key
  on public.billing_charges (provider_session_id) where provider_session_id is not null;

-- The next number of an issuer for the year of p_on. Must run inside the transaction
-- that inserts the charge: the counter row stays locked until it commits.
create or replace function private.next_invoice_number(p_issuer text, p_on date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_year integer := extract(year from p_on)::integer;
  v_n integer;
begin
  select i.invoice_prefix into v_prefix from public.billing_issuers i where i.key = p_issuer;
  if v_prefix is null then
    raise exception 'issuer_not_found' using errcode = 'PT404';
  end if;
  insert into private.invoice_counters (issuer_key, year) values (p_issuer, v_year)
  on conflict (issuer_key, year) do nothing;
  select c.last_number into v_n from private.invoice_counters c
  where c.issuer_key = p_issuer and c.year = v_year
  for update;
  v_n := v_n + 1;
  update private.invoice_counters set last_number = v_n
  where issuer_key = p_issuer and year = v_year;
  return v_prefix || '-' || v_year::text || '-' || case when v_n < 10000 then lpad(v_n::text, 4, '0') else v_n::text end;
end;
$$;

-- Issued = inserted: the number is assigned by the database, never by the caller.
create or replace function private.billing_charge_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.issuer_key := coalesce(new.issuer_key, 'levelup');
  new.issued_on := (coalesce(new.created_at, now()) at time zone 'America/Toronto')::date;
  new.invoice_number := private.next_invoice_number(new.issuer_key, new.issued_on);
  return new;
end;
$$;

-- Numbers, issuer and issue date never change once set.
create or replace function private.billing_charge_keep_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.invoice_number is not null then
    new.invoice_number := old.invoice_number;
    new.issuer_key := old.issuer_key;
    new.issued_on := old.issued_on;
  end if;
  return new;
end;
$$;

revoke all on function private.next_invoice_number(text, date) from public, anon, authenticated;
revoke all on function private.billing_charge_before_insert() from public, anon, authenticated;
revoke all on function private.billing_charge_keep_number() from public, anon, authenticated;

drop trigger if exists billing_charges_invoice_number on public.billing_charges;
create trigger billing_charges_invoice_number before insert on public.billing_charges
  for each row execute function private.billing_charge_before_insert();
drop trigger if exists billing_charges_keep_number on public.billing_charges;
create trigger billing_charges_keep_number before update on public.billing_charges
  for each row execute function private.billing_charge_keep_number();

-- Charges created before this migration get their numbers in creation order.
do $$
declare r record;
begin
  for r in select c.id, c.created_at from public.billing_charges c
           where c.invoice_number is null order by c.created_at, c.id loop
    update public.billing_charges set
      issuer_key = 'levelup',
      issued_on = (r.created_at at time zone 'America/Toronto')::date,
      invoice_number = private.next_invoice_number('levelup', (r.created_at at time zone 'America/Toronto')::date)
    where id = r.id;
  end loop;
end;
$$;

alter table public.billing_charges alter column issuer_key set default 'levelup';
alter table public.billing_charges alter column issuer_key set not null;
alter table public.billing_charges alter column invoice_number set not null;
alter table public.billing_charges alter column issued_on set not null;

-- @part 3: JSON of a charge (same keys as before, plus the document fields) ------------

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
    'paid_at', c.paid_at, 'payment_note', c.payment_note, 'created_at', c.created_at,
    'invoice_number', c.invoice_number, 'issued_on', c.issued_on,
    'payment_method', c.payment_method, 'payment_reference', c.payment_reference,
    'paid_amount', c.paid_amount);
$$;

-- Legal name, address and e-mail are required before documents go to clients.
create or replace function private.billing_issuer_ready(p_issuer text default 'levelup')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select nullif(btrim(i.legal_name), '') is not null
       and nullif(btrim(i.address), '') is not null
       and nullif(btrim(i.email), '') is not null
    from public.billing_issuers i where i.key = p_issuer), false);
$$;

revoke all on function private.billing_issuer_ready(text) from public, anon, authenticated;

-- @part 4: client summary: same as before plus `documents_ready` in `money` -------------

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
        and due_date < (now() at time zone 'America/Toronto')::date),
    'documents_ready', private.billing_issuer_ready('levelup')
  ));
end;
$$;

-- @part 5: payments recorded by staff (the receipt) -------------------------------------

create or replace function public.admin_record_charge_payment(
  p_id uuid,
  p_method text,
  p_paid_on date default null,
  p_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.billing_charges;
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_on date := coalesce(p_paid_on, (now() at time zone 'America/Toronto')::date);
  v_ref text;
begin
  perform private.assert_platform_admin();
  if p_method is null or p_method not in ('cash', 'bank_transfer', 'mobile_money', 'card', 'other') then
    raise exception 'invalid_method' using errcode = '22023';
  end if;
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
  if v_on > v_today + 1 or v_on < v_row.issued_on - 366 then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  v_ref := nullif(private.check_text(p_reference, 120, 'reference'), '');

  update public.billing_charges set
    status = 'paid',
    -- Noon in the clients' time zone: the paid date never shifts.
    paid_at = (v_on + time '12:00') at time zone 'America/Toronto',
    payment_method = p_method,
    payment_reference = v_ref,
    payment_note = nullif(private.check_text(p_note, 300, 'note'), ''),
    paid_amount = v_row.amount
  where id = p_id returning * into v_row;

  perform private.hq_log('billing.charge_paid', 'organization', v_row.organization_id::text,
    jsonb_build_object('charge_id', v_row.id, 'invoice_number', v_row.invoice_number,
      'amount', v_row.amount, 'currency', v_row.currency, 'method', p_method,
      'paid_on', v_on, 'has_reference', v_ref is not null));
  return private.charge_json(v_row);
end;
$$;

-- Older callers: same record, method `other`.
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
begin
  return public.admin_record_charge_payment(p_id, 'other',
    case when p_paid_at is not null then (p_paid_at at time zone 'America/Toronto')::date end,
    null, p_note);
end;
$$;

-- @part 6: documents -----------------------------------------------------------------

-- What the invoice / receipt shows. Owners and admins of the charge's organization,
-- LevelUp staff (aal2) through has_org_role. Everyone else: charge_not_found.
create or replace function public.billing_charge_document(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c public.billing_charges;
  v_i public.billing_issuers;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  select * into v_c from public.billing_charges where id = p_id;
  if not found or not private.has_org_role(v_c.organization_id, 'admin') then
    raise exception 'charge_not_found' using errcode = 'PT404';
  end if;
  select * into v_i from public.billing_issuers where key = v_c.issuer_key;
  return jsonb_build_object(
    'charge', private.charge_json(v_c),
    'organization', (select jsonb_build_object('id', o.id, 'name', o.name)
                     from public.organizations o where o.id = v_c.organization_id),
    'issuer', jsonb_build_object('legal_name', v_i.legal_name, 'address', v_i.address,
      'email', v_i.email, 'tax_id', v_i.tax_id),
    'issuer_ready', private.billing_issuer_ready(v_c.issuer_key),
    'staff', private.is_platform_admin());
end;
$$;

-- @part 7: issuer settings (staff) ------------------------------------------------------

create or replace function public.admin_get_billing_issuer()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_i public.billing_issuers;
begin
  perform private.assert_platform_admin();
  select * into v_i from public.billing_issuers where key = 'levelup';
  return jsonb_build_object('key', v_i.key, 'invoice_prefix', v_i.invoice_prefix,
    'legal_name', v_i.legal_name, 'address', v_i.address, 'email', v_i.email,
    'tax_id', v_i.tax_id, 'ready', private.billing_issuer_ready('levelup'),
    'updated_at', v_i.updated_at);
end;
$$;

create or replace function public.admin_save_billing_issuer(
  p_legal_name text,
  p_address text,
  p_email text,
  p_tax_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(private.check_text(p_legal_name, 200, 'legal_name'), '');
  v_address text := nullif(private.check_text(p_address, 500, 'address', true), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_tax text := nullif(private.check_text(p_tax_id, 80, 'tax_id'), '');
begin
  perform private.assert_platform_admin();
  if v_email is not null and not private.is_valid_email(v_email) then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  update public.billing_issuers set legal_name = v_name, address = v_address, email = v_email,
    tax_id = v_tax, updated_by = auth.uid()
  where key = 'levelup';
  perform private.hq_log('billing.issuer_updated', null, 'levelup',
    jsonb_build_object('legal_name', v_name, 'has_address', v_address is not null,
      'email', v_email, 'has_tax_id', v_tax is not null,
      'ready', private.billing_issuer_ready('levelup')));
  return public.admin_get_billing_issuer();
end;
$$;

-- @part 8: grants ----------------------------------------------------------------------

revoke all on function public.admin_record_charge_payment(uuid, text, date, text, text) from public, anon;
revoke all on function public.admin_mark_charge_paid(uuid, timestamptz, text) from public, anon;
revoke all on function public.billing_charge_document(uuid) from public, anon;
revoke all on function public.admin_get_billing_issuer() from public, anon;
revoke all on function public.admin_save_billing_issuer(text, text, text, text) from public, anon;
grant execute on function public.admin_record_charge_payment(uuid, text, date, text, text) to authenticated;
grant execute on function public.admin_mark_charge_paid(uuid, timestamptz, text) to authenticated;
grant execute on function public.billing_charge_document(uuid) to authenticated;
grant execute on function public.admin_get_billing_issuer() to authenticated;
grant execute on function public.admin_save_billing_issuer(text, text, text, text) to authenticated;
revoke all on function public.billing_summary(uuid) from public, anon;
grant execute on function public.billing_summary(uuid) to authenticated;
