-- Payments made on a client website (Stripe Checkout first, Black Pater).
--
-- The server of the website reports each payment event with its server key
-- (public.site_ingest_payment, see docs/site-api.md). Members of the
-- organization read payments; nobody writes them directly. Customer details
-- (email, name, metadata) are not readable from the table: they come from
-- site_payments_list / site_payment_detail, which mask them for viewers.

create table if not exists public.site_payments (
  id uuid primary key default gen_random_uuid(),
  website_id text not null,
  organization_id uuid not null,
  provider text not null default 'stripe' check (provider in ('stripe')),
  livemode boolean not null default true,
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 255),
  provider_session_id text not null check (char_length(provider_session_id) between 1 and 255),
  provider_payment_intent text
    check (provider_payment_intent is null or char_length(provider_payment_intent) <= 255),
  status text not null check (status in ('paid', 'pending', 'failed', 'refunded', 'expired')),
  amount bigint not null check (amount between 0 and 100000000000),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  offer_id text check (offer_id is null or offer_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'),
  offer_name text check (offer_name is null or char_length(offer_name) <= 200),
  customer_email text check (customer_email is null or char_length(customer_email) <= 254),
  customer_name text check (customer_name is null or char_length(customer_name) <= 120),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  occurred_at timestamptz not null,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, provider_session_id),
  foreign key (website_id, organization_id)
    references public.websites (id, organization_id) on delete cascade
);

create index if not exists site_payments_site_time_idx
  on public.site_payments (website_id, occurred_at desc);
create index if not exists site_payments_site_status_idx
  on public.site_payments (website_id, status);

drop trigger if exists site_payments_updated_at on public.site_payments;
create trigger site_payments_updated_at
  before update on public.site_payments
  for each row execute function private.set_updated_at();

-- Every event received (idempotency + history shown in the detail drawer).
create table if not exists public.site_payment_events (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.site_payments (id) on delete cascade,
  website_id text not null,
  organization_id uuid not null,
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 255),
  status text not null check (status in ('paid', 'pending', 'failed', 'refunded', 'expired')),
  amount bigint check (amount is null or amount between 0 and 100000000000),
  applied boolean not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  unique (website_id, provider_event_id),
  foreign key (website_id, organization_id)
    references public.websites (id, organization_id) on delete cascade
);

create index if not exists site_payment_events_payment_idx
  on public.site_payment_events (payment_id, received_at);

alter table public.site_payments enable row level security;
alter table public.site_payment_events enable row level security;
revoke all on public.site_payments from public, anon, authenticated;
revoke all on public.site_payment_events from public, anon, authenticated;

-- No customer column, no metadata: those go through the masking functions.
grant select (id, website_id, organization_id, provider, livemode, provider_session_id, status,
              amount, currency, offer_id, offer_name, occurred_at, paid_at, refunded_at,
              created_at, updated_at)
  on public.site_payments to authenticated;
grant select on public.site_payment_events to authenticated;

drop policy if exists site_payments_member_read on public.site_payments;
create policy site_payments_member_read on public.site_payments
  for select to authenticated
  using (private.has_org_role(organization_id, 'viewer'));

drop policy if exists site_payment_events_member_read on public.site_payment_events;
create policy site_payment_events_member_read on public.site_payment_events
  for select to authenticated
  using (private.has_org_role(organization_id, 'viewer'));

-- ---------------------------------------------------------------- helpers

-- Allowed status changes. A payment never goes back from paid to pending,
-- failed or expired; refunded and expired are final.
create or replace function private.payment_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'pending' then p_to in ('paid', 'failed', 'expired')
    when 'failed' then p_to in ('paid', 'expired')
    when 'paid' then p_to = 'refunded'
    else false
  end;
$$;

-- j***@e***.com
create or replace function private.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null then null
    when position('@' in p_email) < 2 then '***'
    else left(p_email, 1) || '***@' || left(split_part(p_email, '@', 2), 1) || '***'
      || coalesce(substring(split_part(p_email, '@', 2) from '\.[A-Za-z]{2,63}$'), '')
  end;
$$;

-- Jane Doe -> J. D.
create or replace function private.mask_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name is null then null
    else (select string_agg(left(w, 1) || '.', ' ')
          from unnest((regexp_split_to_array(btrim(p_name), '\s+'))[1:3]) as w
          where w <> '')
  end;
$$;

revoke all on function private.payment_transition_allowed(text, text) from public, anon, authenticated;
revoke all on function private.mask_email(text) from public, anon, authenticated;
revoke all on function private.mask_name(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- ingestion

-- Called by the website server with its key (anon role, publishable key).
-- Event contract: docs/site-api.md. Returns { ok, applied, duplicate, status }.
create or replace function public.site_ingest_payment(p_key text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key_id uuid;
  v_site text;
  v_org uuid;
  v_live boolean;
  v_allowed text[] := array['provider', 'provider_event_id', 'provider_session_id',
    'provider_payment_intent', 'status', 'amount', 'currency', 'offer_id', 'offer_name',
    'customer_email', 'customer_name', 'occurred_at', 'metadata'];
  v_field text;
  v_event_id text;
  v_session text;
  v_pi text;
  v_status text;
  v_amount bigint;
  v_currency text;
  v_offer_id text;
  v_offer_name text;
  v_email text;
  v_name text;
  v_at timestamptz;
  v_at_text text;
  v_meta jsonb;
  v_row public.site_payments;
  v_applied boolean := false;
  v_livemode boolean;
begin
  select k.key_id, k.website_id, k.organization_id, k.livemode
  into v_key_id, v_site, v_org, v_live
  from private.site_key_website(p_key, 'payments:write') as k;

  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    raise exception 'Invalid event: a JSON object is expected' using errcode = '22023';
  end if;
  if octet_length(p_event::text) > 16384 then
    raise exception 'Invalid event: too large' using errcode = '22023';
  end if;
  for v_field in select jsonb_object_keys(p_event) loop
    if not (v_field = any (v_allowed)) then
      raise exception 'Invalid event: unknown field %',
        left(regexp_replace(v_field, '[^A-Za-z0-9_]', '', 'g'), 40) using errcode = '22023';
    end if;
  end loop;
  -- Every text field is a JSON string (or null where optional).
  foreach v_field in array array['provider', 'provider_event_id', 'provider_session_id',
    'provider_payment_intent', 'status', 'currency', 'offer_id', 'offer_name',
    'customer_email', 'customer_name', 'occurred_at'] loop
    if p_event ? v_field and jsonb_typeof(p_event -> v_field) not in ('string', 'null') then
      raise exception 'Invalid event: % must be a string', v_field using errcode = '22023';
    end if;
  end loop;

  if coalesce(p_event ->> 'provider', '') <> 'stripe' then
    raise exception 'Invalid event: provider must be stripe' using errcode = '22023';
  end if;

  v_event_id := p_event ->> 'provider_event_id';
  if v_event_id is null or v_event_id !~ '^evt_[A-Za-z0-9_]{1,250}$' then
    raise exception 'Invalid event: provider_event_id' using errcode = '22023';
  end if;
  v_session := p_event ->> 'provider_session_id';
  if v_session is null or v_session !~ '^cs_[A-Za-z0-9_]{1,250}$' then
    raise exception 'Invalid event: provider_session_id' using errcode = '22023';
  end if;
  if v_live and v_session ~ '^cs_test_' then
    raise exception 'Invalid event: test session sent with a live key' using errcode = '22023';
  end if;
  v_livemode := v_live and v_session !~ '^cs_test_';
  v_pi := nullif(p_event ->> 'provider_payment_intent', '');
  if v_pi is not null and v_pi !~ '^pi_[A-Za-z0-9_]{1,250}$' then
    raise exception 'Invalid event: provider_payment_intent' using errcode = '22023';
  end if;

  v_status := p_event ->> 'status';
  if v_status is null or v_status not in ('paid', 'pending', 'failed', 'refunded', 'expired') then
    raise exception 'Invalid event: status' using errcode = '22023';
  end if;

  if coalesce(jsonb_typeof(p_event -> 'amount'), '') <> 'number'
     or coalesce(p_event ->> 'amount', '') !~ '^[0-9]{1,12}$' then
    raise exception 'Invalid event: amount must be a whole number of minor units' using errcode = '22023';
  end if;
  v_amount := (p_event ->> 'amount')::bigint;
  if v_amount > 100000000000 then
    raise exception 'Invalid event: amount' using errcode = '22023';
  end if;

  v_currency := p_event ->> 'currency';
  if v_currency is null or v_currency !~ '^[a-z]{3}$' then
    raise exception 'Invalid event: currency (ISO 4217, lowercase)' using errcode = '22023';
  end if;

  v_offer_id := nullif(p_event ->> 'offer_id', '');
  if v_offer_id is not null and v_offer_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$' then
    raise exception 'Invalid event: offer_id' using errcode = '22023';
  end if;
  v_offer_name := private.check_text(p_event ->> 'offer_name', 200, 'offer_name');

  v_email := lower(private.check_text(p_event ->> 'customer_email', 254, 'customer_email'));
  if v_email is not null and not private.is_valid_email(v_email) then
    raise exception 'Invalid event: customer_email' using errcode = '22023';
  end if;
  v_name := private.check_text(p_event ->> 'customer_name', 120, 'customer_name');

  v_at_text := p_event ->> 'occurred_at';
  if v_at_text is null
     or v_at_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:?[0-9]{2})$' then
    raise exception 'Invalid event: occurred_at (ISO 8601 with time zone)' using errcode = '22023';
  end if;
  begin
    v_at := v_at_text::timestamptz;
  exception when others then
    raise exception 'Invalid event: occurred_at (ISO 8601 with time zone)' using errcode = '22023';
  end;
  if v_at < timestamptz '2015-01-01' or v_at > now() + interval '1 day' then
    raise exception 'Invalid event: occurred_at out of range' using errcode = '22023';
  end if;

  if p_event ? 'metadata' and jsonb_typeof(p_event -> 'metadata') not in ('object', 'null') then
    raise exception 'Invalid event: metadata must be an object' using errcode = '22023';
  end if;
  v_meta := coalesce(nullif(p_event -> 'metadata', 'null'::jsonb), '{}'::jsonb);
  if octet_length(v_meta::text) > 8192 then
    raise exception 'Invalid event: metadata is larger than 8 KB' using errcode = '22023';
  end if;
  v_meta := private.clean_jsonb(v_meta);
  if pg_column_size(v_meta) > 8192 then
    raise exception 'Invalid event: metadata is larger than 8 KB' using errcode = '22023';
  end if;

  -- Same event twice (webhook retry): nothing changes.
  if exists (select 1 from public.site_payment_events
             where website_id = v_site and provider_event_id = v_event_id) then
    select * into v_row from public.site_payments
    where website_id = v_site and provider_session_id = v_session;
    return jsonb_build_object('ok', true, 'applied', false, 'duplicate', true,
                              'status', v_row.status);
  end if;

  insert into public.site_payments (
    website_id, organization_id, provider, livemode, provider_event_id, provider_session_id,
    provider_payment_intent, status, amount, currency, offer_id, offer_name, customer_email,
    customer_name, metadata, occurred_at, paid_at, refunded_at
  ) values (
    v_site, v_org, 'stripe', v_livemode, v_event_id, v_session, v_pi, v_status, v_amount,
    v_currency, v_offer_id, v_offer_name, v_email, v_name, v_meta, v_at,
    case when v_status in ('paid', 'refunded') then v_at end,
    case when v_status = 'refunded' then v_at end
  )
  on conflict (website_id, provider_session_id) do nothing
  returning * into v_row;

  if v_row.id is not null then
    v_applied := true;
  else
    select * into v_row from public.site_payments
    where website_id = v_site and provider_session_id = v_session
    for update;
    v_applied := private.payment_transition_allowed(v_row.status, v_status);
    if v_applied then
      update public.site_payments set
        status = v_status,
        provider_event_id = v_event_id,
        amount = case when v_status = 'refunded' then amount else v_amount end,
        currency = case when v_status = 'refunded' then currency else v_currency end,
        provider_payment_intent = coalesce(v_pi, provider_payment_intent),
        offer_id = coalesce(v_offer_id, offer_id),
        offer_name = coalesce(v_offer_name, offer_name),
        customer_email = coalesce(v_email, customer_email),
        customer_name = coalesce(v_name, customer_name),
        metadata = case when pg_column_size(metadata || v_meta) <= 8192
                        then metadata || v_meta else metadata end,
        occurred_at = greatest(occurred_at, v_at),
        paid_at = case when v_status = 'paid' then v_at else paid_at end,
        refunded_at = case when v_status = 'refunded' then v_at else refunded_at end
      where id = v_row.id
      returning * into v_row;
    else
      -- Late or repeated event: only fill in details that were missing.
      update public.site_payments set
        provider_payment_intent = coalesce(provider_payment_intent, v_pi),
        offer_id = coalesce(offer_id, v_offer_id),
        offer_name = coalesce(offer_name, v_offer_name),
        customer_email = coalesce(customer_email, v_email),
        customer_name = coalesce(customer_name, v_name)
      where id = v_row.id
      returning * into v_row;
    end if;
  end if;

  insert into public.site_payment_events (payment_id, website_id, organization_id,
    provider_event_id, status, amount, applied, occurred_at)
  values (v_row.id, v_site, v_org, v_event_id, v_status, v_amount, v_applied, v_at)
  on conflict (website_id, provider_event_id) do nothing;

  return jsonb_build_object('ok', true, 'applied', v_applied, 'duplicate', false,
                            'status', v_row.status);
end;
$$;

revoke all on function public.site_ingest_payment(text, jsonb) from public;
grant execute on function public.site_ingest_payment(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- reading

-- One payment as JSON; customer details masked unless p_pii.
create or replace function private.payment_json(p public.site_payments, p_pii boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'provider', p.provider,
    'livemode', p.livemode,
    'provider_session_id', p.provider_session_id,
    'provider_payment_intent', p.provider_payment_intent,
    'status', p.status,
    'amount', p.amount,
    'currency', p.currency,
    'offer_id', p.offer_id,
    'offer_name', p.offer_name,
    'customer_email', case when p_pii then p.customer_email else private.mask_email(p.customer_email) end,
    'customer_name', case when p_pii then p.customer_name else private.mask_name(p.customer_name) end,
    'masked', not p_pii,
    'occurred_at', p.occurred_at,
    'paid_at', p.paid_at,
    'refunded_at', p.refunded_at,
    'created_at', p.created_at,
    'updated_at', p.updated_at
  );
$$;

revoke all on function private.payment_json(public.site_payments, boolean) from public, anon, authenticated;

-- Search / filter / sort / paginate. Viewer+; customer details for editor+.
create or replace function public.site_payments_list(
  p_website_id text,
  p_search text default null,
  p_status text[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_livemode boolean default true,
  p_sort text default 'occurred_at',
  p_desc boolean default true,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_pii boolean;
  v_q text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_sort text := coalesce(p_sort, 'occurred_at');
  v_total bigint;
  v_rows jsonb;
begin
  select organization_id into v_org from public.websites where id = p_website_id;
  if v_org is null or not private.has_org_role(v_org, 'viewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_pii := private.has_org_role(v_org, 'editor');
  if v_sort not in ('occurred_at', 'amount', 'status', 'offer_name', 'customer') then
    v_sort := 'occurred_at';
  end if;
  if v_sort = 'customer' and not v_pii then
    v_sort := 'occurred_at';
  end if;
  v_q := nullif(private.clean_line(p_search, 100), '');
  if v_q is not null then
    v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with filtered as (
    select p as r, p.amount, p.status, p.offer_name,
           coalesce(p.customer_name, p.customer_email) as customer, p.occurred_at
    from public.site_payments p
    where p.website_id = p_website_id
      and (p_livemode is null or p.livemode = p_livemode)
      and (p_status is null or cardinality(p_status) = 0 or p.status = any (p_status))
      and (p_from is null or p.occurred_at >= p_from)
      and (p_to is null or p.occurred_at < p_to)
      and (v_q is null
        or p.offer_name ilike v_q or p.offer_id ilike v_q
        or p.provider_session_id ilike v_q or p.provider_payment_intent ilike v_q
        or (v_pii and (p.customer_email ilike v_q or p.customer_name ilike v_q)))
  ),
  ranked as (
    select f.r, row_number() over (order by
      case when v_sort = 'amount' and not p_desc then f.amount end asc,
      case when v_sort = 'amount' and p_desc then f.amount end desc,
      case when v_sort = 'status' and not p_desc then f.status end asc,
      case when v_sort = 'status' and p_desc then f.status end desc,
      case when v_sort = 'offer_name' and not p_desc then f.offer_name end asc,
      case when v_sort = 'offer_name' and p_desc then f.offer_name end desc,
      case when v_sort = 'customer' and not p_desc then f.customer end asc,
      case when v_sort = 'customer' and p_desc then f.customer end desc,
      case when not p_desc then f.occurred_at end asc,
      f.occurred_at desc) as rn
    from filtered f
  )
  select (select count(*) from filtered),
         coalesce((select jsonb_agg(private.payment_json(x.r, v_pii) order by x.rn)
                   from ranked x
                   where x.rn > v_offset and x.rn <= v_offset + v_limit), '[]'::jsonb)
  into v_total, v_rows;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'pii', v_pii);
end;
$$;

-- One payment with its events and (editor+) metadata.
create or replace function public.site_payment_detail(p_payment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.site_payments;
  v_pii boolean;
begin
  select * into v_row from public.site_payments where id = p_payment_id;
  if not found or not private.has_org_role(v_row.organization_id, 'viewer') then
    raise exception 'not found' using errcode = 'PT404';
  end if;
  v_pii := private.has_org_role(v_row.organization_id, 'editor');
  return private.payment_json(v_row, v_pii)
    || jsonb_build_object(
      'metadata', case when v_pii then v_row.metadata else '{}'::jsonb end,
      'events', coalesce((
        select jsonb_agg(jsonb_build_object(
          'provider_event_id', e.provider_event_id, 'status', e.status, 'amount', e.amount,
          'applied', e.applied, 'occurred_at', e.occurred_at, 'received_at', e.received_at)
          order by e.received_at, e.id)
        from public.site_payment_events e where e.payment_id = v_row.id), '[]'::jsonb));
end;
$$;

-- CSV export (owner / admin): up to 5000 rows with customer details, audited.
create or replace function public.site_payments_export(
  p_website_id text,
  p_status text[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_livemode boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_rows jsonb;
  v_count integer;
begin
  select organization_id into v_org from public.websites where id = p_website_id;
  if v_org is null or not private.has_org_role(v_org, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_mfa();
  perform private.hit_rate_limit('site_payments_export', (select auth.uid())::text, 30, interval '1 hour');
  select coalesce(jsonb_agg(private.payment_json(x.r, true) order by x.occurred_at desc), '[]'::jsonb),
         count(*)
  into v_rows, v_count
  from (
    select p as r, p.occurred_at from public.site_payments p
    where p.website_id = p_website_id
      and (p_livemode is null or p.livemode = p_livemode)
      and (p_status is null or cardinality(p_status) = 0 or p.status = any (p_status))
      and (p_from is null or p.occurred_at >= p_from)
      and (p_to is null or p.occurred_at < p_to)
    order by p.occurred_at desc
    limit 5000
  ) x;
  perform private.site_audit(p_website_id, v_org, 'payments.exported', null,
    jsonb_build_object('rows', v_count));
  return v_rows;
end;
$$;

-- KPIs for a period (amounts per currency) and the daily paid revenue.
-- Days follow the dashboard time zone (America/Toronto).
create or replace function public.site_payments_summary(
  p_website_id text,
  p_days integer default 30,
  p_livemode boolean default true
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 366);
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_from timestamptz;
  v_prev timestamptz;
begin
  v_from := ((v_today - (v_days - 1))::timestamp) at time zone 'America/Toronto';
  v_prev := ((v_today - (2 * v_days - 1))::timestamp) at time zone 'America/Toronto';
  return jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'currencies', coalesce((
      select jsonb_agg(c order by (c ->> 'revenue')::bigint desc) from (
        select jsonb_build_object(
          'currency', p.currency,
          'revenue', coalesce(sum(p.amount) filter (where p.status in ('paid', 'refunded') and p.paid_at >= v_from), 0),
          'refunded', coalesce(sum(p.amount) filter (where p.status = 'refunded' and p.refunded_at >= v_from), 0),
          'paid_count', count(*) filter (where p.status in ('paid', 'refunded') and p.paid_at >= v_from),
          'refund_count', count(*) filter (where p.status = 'refunded' and p.refunded_at >= v_from),
          'previous_revenue', coalesce(sum(p.amount) filter (where p.status in ('paid', 'refunded')
            and p.paid_at >= v_prev and p.paid_at < v_from), 0)
        ) as c
        from public.site_payments p
        where p.website_id = p_website_id
          and (p_livemode is null or p.livemode = p_livemode)
          and (p.paid_at >= v_prev or p.refunded_at >= v_from)
        group by p.currency
      ) x), '[]'::jsonb),
    'pending_count', (select count(*) from public.site_payments p
      where p.website_id = p_website_id and p.status = 'pending'
        and (p_livemode is null or p.livemode = p_livemode) and p.occurred_at >= v_from),
    'failed_count', (select count(*) from public.site_payments p
      where p.website_id = p_website_id and p.status in ('failed', 'expired')
        and (p_livemode is null or p.livemode = p_livemode) and p.occurred_at >= v_from),
    'total_count', (select count(*) from public.site_payments p
      where p.website_id = p_website_id and (p_livemode is null or p.livemode = p_livemode)),
    'test_count', (select count(*) from public.site_payments p
      where p.website_id = p_website_id and not p.livemode),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'currency', d.currency, 'amount', d.amount,
                                          'count', d.n) order by d.day, d.currency)
      from (
        select (p.paid_at at time zone 'America/Toronto')::date as day, p.currency,
               sum(p.amount) as amount, count(*) as n
        from public.site_payments p
        where p.website_id = p_website_id and p.status in ('paid', 'refunded')
          and (p_livemode is null or p.livemode = p_livemode) and p.paid_at >= v_from
        group by 1, 2
      ) d), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(o order by (o ->> 'amount')::bigint desc) from (
        select jsonb_build_object('offer', coalesce(p.offer_name, p.offer_id, ''),
                                  'currency', p.currency, 'amount', sum(p.amount), 'count', count(*)) as o
        from public.site_payments p
        where p.website_id = p_website_id and p.status in ('paid', 'refunded')
          and (p_livemode is null or p.livemode = p_livemode) and p.paid_at >= v_from
        group by coalesce(p.offer_name, p.offer_id, ''), p.currency
        order by sum(p.amount) desc
        limit 8
      ) y), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.site_payments_list(text, text, text[], timestamptz, timestamptz, boolean, text, boolean, integer, integer) from public, anon;
revoke all on function public.site_payment_detail(uuid) from public, anon;
revoke all on function public.site_payments_export(text, text[], timestamptz, timestamptz, boolean) from public, anon;
revoke all on function public.site_payments_summary(text, integer, boolean) from public, anon;
grant execute on function public.site_payments_list(text, text, text[], timestamptz, timestamptz, boolean, text, boolean, integer, integer) to authenticated;
grant execute on function public.site_payment_detail(uuid) to authenticated;
grant execute on function public.site_payments_export(text, text[], timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.site_payments_summary(text, integer, boolean) to authenticated;
