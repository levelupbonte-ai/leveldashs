-- Site payments from any payment provider, not only Stripe (docs/site-api.md).
--
-- The contract becomes provider-neutral: an allow-listed provider slug, a
-- payment method, generic field names (provider_payment_id,
-- provider_reference, customer {}, offer {}) with the former Stripe names kept
-- as aliases, a `cancelled` status, and idempotency per website + provider +
-- payment id (and per website + provider + event id for the events).
--
-- Storage keeps its column names (no rename): provider_session_id holds the
-- provider's payment / session / transaction id, provider_payment_intent the
-- secondary reference. The readers return both the new and the old keys.
--
-- Schema changes only (the tables are empty in production when this ships):
-- wider CHECK constraints replace the Stripe-only ones, the unique keys gain
-- the provider column. No data is deleted.

-- ---------------------------------------------------------------- providers

-- The allowed provider slugs, in one place (the CHECK constraints below list
-- the same values; supabase/tests/payments_providers.sql checks each one).
create or replace function private.site_payment_providers()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    -- cards / global checkouts
    'stripe', 'paypal', 'square', 'mollie', 'lemonsqueezy', 'paddle', 'adyen',
    'braintree', 'razorpay',
    -- African aggregators
    'flutterwave', 'paystack', 'cinetpay', 'fedapay', 'kkiapay', 'pesapal', 'hubtel',
    -- mobile money (direct or through an aggregator)
    'wave', 'mtn_momo', 'orange_money', 'mpesa', 'airtel_money', 'moov_money',
    -- offline
    'bank_transfer', 'cash_on_delivery',
    'other'
  ]::text[];
$$;

create or replace function private.site_payment_methods()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['card', 'mobile_money', 'bank_transfer', 'paypal', 'cash', 'other']::text[];
$$;

revoke all on function private.site_payment_providers() from public, anon, authenticated;
revoke all on function private.site_payment_methods() from public, anon, authenticated;

-- ---------------------------------------------------------------- columns

alter table public.site_payments add column if not exists method text;
alter table public.site_payment_events add column if not exists provider text not null default 'stripe';

alter table public.site_payments drop constraint if exists site_payments_provider_check;
alter table public.site_payments add constraint site_payments_provider_check check (provider in (
  'stripe', 'paypal', 'square', 'mollie', 'lemonsqueezy', 'paddle', 'adyen', 'braintree', 'razorpay',
  'flutterwave', 'paystack', 'cinetpay', 'fedapay', 'kkiapay', 'pesapal', 'hubtel',
  'wave', 'mtn_momo', 'orange_money', 'mpesa', 'airtel_money', 'moov_money',
  'bank_transfer', 'cash_on_delivery', 'other'));

alter table public.site_payment_events drop constraint if exists site_payment_events_provider_check;
alter table public.site_payment_events add constraint site_payment_events_provider_check check (provider in (
  'stripe', 'paypal', 'square', 'mollie', 'lemonsqueezy', 'paddle', 'adyen', 'braintree', 'razorpay',
  'flutterwave', 'paystack', 'cinetpay', 'fedapay', 'kkiapay', 'pesapal', 'hubtel',
  'wave', 'mtn_momo', 'orange_money', 'mpesa', 'airtel_money', 'moov_money',
  'bank_transfer', 'cash_on_delivery', 'other'));

alter table public.site_payments drop constraint if exists site_payments_method_check;
alter table public.site_payments add constraint site_payments_method_check check (
  method is null or method in ('card', 'mobile_money', 'bank_transfer', 'paypal', 'cash', 'other'));

alter table public.site_payments drop constraint if exists site_payments_status_check;
alter table public.site_payments add constraint site_payments_status_check check (
  status in ('paid', 'pending', 'failed', 'refunded', 'expired', 'cancelled'));
alter table public.site_payment_events drop constraint if exists site_payment_events_status_check;
alter table public.site_payment_events add constraint site_payment_events_status_check check (
  status in ('paid', 'pending', 'failed', 'refunded', 'expired', 'cancelled'));

-- Idempotency per website + provider: the same id at two providers is two payments.
create unique index if not exists site_payments_site_provider_payment_key
  on public.site_payments (website_id, provider, provider_session_id);
alter table public.site_payments drop constraint if exists site_payments_website_id_provider_session_id_key;

create unique index if not exists site_payment_events_site_provider_event_key
  on public.site_payment_events (website_id, provider, provider_event_id);
alter table public.site_payment_events drop constraint if exists site_payment_events_website_id_provider_event_id_key;

create index if not exists site_payments_site_provider_idx
  on public.site_payments (website_id, provider);

grant select (method) on public.site_payments to authenticated;

-- ---------------------------------------------------------------- helpers

-- Allowed status changes. A payment never goes back from paid to pending,
-- failed, expired or cancelled; refunded, expired and cancelled are final.
create or replace function private.payment_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'pending' then p_to in ('paid', 'failed', 'expired', 'cancelled')
    when 'failed' then p_to in ('paid', 'expired', 'cancelled')
    when 'paid' then p_to = 'refunded'
    else false
  end;
$$;

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
  v_allowed text[] := array['provider', 'provider_event_id', 'provider_payment_id',
    'provider_session_id', 'provider_transaction_id', 'provider_reference',
    'provider_payment_intent', 'method', 'status', 'amount', 'currency', 'livemode',
    'customer', 'customer_email', 'customer_name', 'offer', 'offer_id', 'offer_name',
    'occurred_at', 'metadata'];
  -- Canonical field -> its accepted aliases (one of them at most).
  v_pairs text[][] := array[
    array['provider_payment_id', 'provider_session_id'],
    array['provider_payment_id', 'provider_transaction_id'],
    array['provider_session_id', 'provider_transaction_id'],
    array['provider_reference', 'provider_payment_intent']];
  v_pair text[];
  v_id_pattern text := '^[A-Za-z0-9][A-Za-z0-9_.:@/+=|#-]{0,254}$';
  v_field text;
  v_provider text;
  v_method text;
  v_event_id text;
  v_session text;
  v_pi text;
  v_status text;
  v_amount bigint;
  v_currency text;
  v_customer jsonb;
  v_offer jsonb;
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
  foreach v_field in array array['provider', 'provider_event_id', 'provider_payment_id',
    'provider_session_id', 'provider_transaction_id', 'provider_reference',
    'provider_payment_intent', 'method', 'status', 'currency', 'customer_email',
    'customer_name', 'offer_id', 'offer_name', 'occurred_at'] loop
    if p_event ? v_field and jsonb_typeof(p_event -> v_field) not in ('string', 'null') then
      raise exception 'Invalid event: % must be a string', v_field using errcode = '22023';
    end if;
  end loop;
  -- A field and its alias together are ambiguous.
  foreach v_pair slice 1 in array v_pairs loop
    if p_event ? v_pair[1] and p_event ? v_pair[2] then
      raise exception 'Invalid event: send % or %, not both', v_pair[1], v_pair[2] using errcode = '22023';
    end if;
  end loop;
  if p_event ? 'customer' and (p_event ? 'customer_email' or p_event ? 'customer_name') then
    raise exception 'Invalid event: send customer or customer_email / customer_name, not both' using errcode = '22023';
  end if;
  if p_event ? 'offer' and (p_event ? 'offer_id' or p_event ? 'offer_name') then
    raise exception 'Invalid event: send offer or offer_id / offer_name, not both' using errcode = '22023';
  end if;

  -- Provider: an allow-listed lowercase slug.
  v_provider := p_event ->> 'provider';
  if v_provider is null or not (v_provider = any (private.site_payment_providers())) then
    raise exception 'Invalid event: provider (one of the supported slugs, or "other")' using errcode = '22023';
  end if;

  -- Ids: provider-neutral (letters, digits, _ . : @ / + = | # -, up to 255).
  v_event_id := p_event ->> 'provider_event_id';
  if v_event_id is null or v_event_id !~ v_id_pattern then
    raise exception 'Invalid event: provider_event_id' using errcode = '22023';
  end if;
  v_session := coalesce(p_event ->> 'provider_payment_id', p_event ->> 'provider_session_id',
                        p_event ->> 'provider_transaction_id');
  if v_session is null or v_session !~ v_id_pattern then
    raise exception 'Invalid event: provider_payment_id' using errcode = '22023';
  end if;
  v_pi := nullif(coalesce(p_event ->> 'provider_reference', p_event ->> 'provider_payment_intent'), '');
  if v_pi is not null and v_pi !~ v_id_pattern then
    raise exception 'Invalid event: provider_reference' using errcode = '22023';
  end if;
  -- Stripe keeps its stricter id formats.
  if v_provider = 'stripe' then
    if v_event_id !~ '^evt_[A-Za-z0-9_]{1,250}$' then
      raise exception 'Invalid event: provider_event_id' using errcode = '22023';
    end if;
    if v_session !~ '^(cs|pi|ch|in|py)_[A-Za-z0-9_]{1,250}$' then
      raise exception 'Invalid event: provider_payment_id' using errcode = '22023';
    end if;
    if v_pi is not null and v_pi !~ '^(pi|ch|py)_[A-Za-z0-9_]{1,250}$' then
      raise exception 'Invalid event: provider_reference' using errcode = '22023';
    end if;
  end if;

  -- Test or live: a test key records test payments; a live key refuses a
  -- payment the event itself marks as test.
  if p_event ? 'livemode' and jsonb_typeof(p_event -> 'livemode') not in ('boolean', 'null') then
    raise exception 'Invalid event: livemode must be true or false' using errcode = '22023';
  end if;
  if v_live and ((p_event -> 'livemode') = 'false'::jsonb
                 or (v_provider = 'stripe' and v_session ~ '^cs_test_')) then
    raise exception 'Invalid event: test payment sent with a live key' using errcode = '22023';
  end if;
  v_livemode := v_live;

  v_method := nullif(p_event ->> 'method', '');
  if v_method is not null and not (v_method = any (private.site_payment_methods())) then
    raise exception 'Invalid event: method' using errcode = '22023';
  end if;
  -- Obvious defaults when the method is not sent.
  v_method := coalesce(v_method, case
    when v_provider = 'paypal' then 'paypal'
    when v_provider = 'cash_on_delivery' then 'cash'
    when v_provider = 'bank_transfer' then 'bank_transfer'
    when v_provider in ('wave', 'mtn_momo', 'orange_money', 'mpesa', 'airtel_money', 'moov_money')
      then 'mobile_money'
  end);

  v_status := p_event ->> 'status';
  if v_status is null
     or v_status not in ('paid', 'pending', 'failed', 'refunded', 'expired', 'cancelled') then
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

  -- ISO 4217, any case (providers send "XOF" or "usd"); stored lowercase.
  v_currency := lower(p_event ->> 'currency');
  if v_currency is null or v_currency !~ '^[a-z]{3}$' then
    raise exception 'Invalid event: currency (ISO 4217 code)' using errcode = '22023';
  end if;

  -- customer { email, name } (or customer_email / customer_name).
  v_customer := nullif(p_event -> 'customer', 'null'::jsonb);
  if v_customer is not null then
    if jsonb_typeof(v_customer) <> 'object' then
      raise exception 'Invalid event: customer must be an object' using errcode = '22023';
    end if;
    for v_field in select jsonb_object_keys(v_customer) loop
      if v_field not in ('email', 'name') then
        raise exception 'Invalid event: unknown field customer.%',
          left(regexp_replace(v_field, '[^A-Za-z0-9_]', '', 'g'), 40) using errcode = '22023';
      end if;
      if jsonb_typeof(v_customer -> v_field) not in ('string', 'null') then
        raise exception 'Invalid event: customer.% must be a string', v_field using errcode = '22023';
      end if;
    end loop;
  else
    v_customer := jsonb_build_object('email', p_event -> 'customer_email', 'name', p_event -> 'customer_name');
  end if;
  v_email := lower(private.check_text(v_customer ->> 'email', 254, 'customer.email'));
  if v_email = '' then v_email := null; end if;
  if v_email is not null and not private.is_valid_email(v_email) then
    raise exception 'Invalid event: customer.email' using errcode = '22023';
  end if;
  v_name := nullif(private.check_text(v_customer ->> 'name', 120, 'customer.name'), '');

  -- offer { id, name } (or offer_id / offer_name).
  v_offer := nullif(p_event -> 'offer', 'null'::jsonb);
  if v_offer is not null then
    if jsonb_typeof(v_offer) <> 'object' then
      raise exception 'Invalid event: offer must be an object' using errcode = '22023';
    end if;
    for v_field in select jsonb_object_keys(v_offer) loop
      if v_field not in ('id', 'name') then
        raise exception 'Invalid event: unknown field offer.%',
          left(regexp_replace(v_field, '[^A-Za-z0-9_]', '', 'g'), 40) using errcode = '22023';
      end if;
      if jsonb_typeof(v_offer -> v_field) not in ('string', 'null') then
        raise exception 'Invalid event: offer.% must be a string', v_field using errcode = '22023';
      end if;
    end loop;
  else
    v_offer := jsonb_build_object('id', p_event -> 'offer_id', 'name', p_event -> 'offer_name');
  end if;
  v_offer_id := nullif(v_offer ->> 'id', '');
  if v_offer_id is not null and v_offer_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$' then
    raise exception 'Invalid event: offer.id' using errcode = '22023';
  end if;
  v_offer_name := nullif(private.check_text(v_offer ->> 'name', 200, 'offer.name'), '');

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
             where website_id = v_site and provider = v_provider and provider_event_id = v_event_id) then
    select * into v_row from public.site_payments
    where website_id = v_site and provider = v_provider and provider_session_id = v_session;
    return jsonb_build_object('ok', true, 'applied', false, 'duplicate', true,
                              'status', v_row.status);
  end if;

  insert into public.site_payments (
    website_id, organization_id, provider, method, livemode, provider_event_id, provider_session_id,
    provider_payment_intent, status, amount, currency, offer_id, offer_name, customer_email,
    customer_name, metadata, occurred_at, paid_at, refunded_at
  ) values (
    v_site, v_org, v_provider, v_method, v_livemode, v_event_id, v_session, v_pi, v_status, v_amount,
    v_currency, v_offer_id, v_offer_name, v_email, v_name, v_meta, v_at,
    case when v_status in ('paid', 'refunded') then v_at end,
    case when v_status = 'refunded' then v_at end
  )
  on conflict (website_id, provider, provider_session_id) do nothing
  returning * into v_row;

  if v_row.id is not null then
    v_applied := true;
  else
    select * into v_row from public.site_payments
    where website_id = v_site and provider = v_provider and provider_session_id = v_session
    for update;
    v_applied := private.payment_transition_allowed(v_row.status, v_status);
    if v_applied then
      update public.site_payments set
        status = v_status,
        provider_event_id = v_event_id,
        amount = case when v_status = 'refunded' then amount else v_amount end,
        currency = case when v_status = 'refunded' then currency else v_currency end,
        method = coalesce(v_method, method),
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
        method = coalesce(method, v_method),
        provider_payment_intent = coalesce(provider_payment_intent, v_pi),
        offer_id = coalesce(offer_id, v_offer_id),
        offer_name = coalesce(offer_name, v_offer_name),
        customer_email = coalesce(customer_email, v_email),
        customer_name = coalesce(customer_name, v_name)
      where id = v_row.id
      returning * into v_row;
    end if;
  end if;

  insert into public.site_payment_events (payment_id, website_id, organization_id, provider,
    provider_event_id, status, amount, applied, occurred_at)
  values (v_row.id, v_site, v_org, v_provider, v_event_id, v_status, v_amount, v_applied, v_at)
  on conflict (website_id, provider, provider_event_id) do nothing;

  return jsonb_build_object('ok', true, 'applied', v_applied, 'duplicate', false,
                            'status', v_row.status);
end;
$$;

revoke all on function public.site_ingest_payment(text, jsonb) from public;
grant execute on function public.site_ingest_payment(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- reading

-- One payment as JSON; customer details masked unless p_pii. Generic keys
-- (provider_payment_id, provider_reference) next to the former ones.
create or replace function private.payment_json(p public.site_payments, p_pii boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'provider', p.provider,
    'method', p.method,
    'livemode', p.livemode,
    'provider_payment_id', p.provider_session_id,
    'provider_reference', p.provider_payment_intent,
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

-- The list and the export gain provider / method filters (new signatures; the
-- former ones would make named calls ambiguous).
drop function if exists public.site_payments_list(text, text, text[], timestamptz, timestamptz, boolean, text, boolean, integer, integer);
drop function if exists public.site_payments_export(text, text[], timestamptz, timestamptz, boolean);

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
  p_offset integer default 0,
  p_provider text[] default null,
  p_method text[] default null
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
  if v_sort not in ('occurred_at', 'amount', 'status', 'offer_name', 'customer', 'provider') then
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
    select p as r, p.amount, p.status, p.offer_name, p.provider,
           coalesce(p.customer_name, p.customer_email) as customer, p.occurred_at
    from public.site_payments p
    where p.website_id = p_website_id
      and (p_livemode is null or p.livemode = p_livemode)
      and (p_status is null or cardinality(p_status) = 0 or p.status = any (p_status))
      and (p_provider is null or cardinality(p_provider) = 0 or p.provider = any (p_provider))
      and (p_method is null or cardinality(p_method) = 0 or p.method = any (p_method))
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
      case when v_sort = 'provider' and not p_desc then f.provider end asc,
      case when v_sort = 'provider' and p_desc then f.provider end desc,
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
          'provider', e.provider, 'provider_event_id', e.provider_event_id, 'status', e.status,
          'amount', e.amount, 'applied', e.applied, 'occurred_at', e.occurred_at,
          'received_at', e.received_at)
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
  p_livemode boolean default true,
  p_provider text[] default null,
  p_method text[] default null
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
      and (p_provider is null or cardinality(p_provider) = 0 or p.provider = any (p_provider))
      and (p_method is null or cardinality(p_method) = 0 or p.method = any (p_method))
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

-- KPIs for a period (amounts per currency), the daily paid revenue, and the
-- providers / methods in use (filters). Days follow America/Toronto.
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
      where p.website_id = p_website_id and p.status in ('failed', 'expired', 'cancelled')
        and (p_livemode is null or p.livemode = p_livemode) and p.occurred_at >= v_from),
    'total_count', (select count(*) from public.site_payments p
      where p.website_id = p_website_id and (p_livemode is null or p.livemode = p_livemode)),
    'test_count', (select count(*) from public.site_payments p
      where p.website_id = p_website_id and not p.livemode),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object('provider', x.provider, 'count', x.n) order by x.n desc, x.provider)
      from (select p.provider, count(*) as n from public.site_payments p
            where p.website_id = p_website_id and (p_livemode is null or p.livemode = p_livemode)
            group by p.provider) x), '[]'::jsonb),
    'methods', coalesce((
      select jsonb_agg(jsonb_build_object('method', x.method, 'count', x.n) order by x.n desc, x.method)
      from (select p.method, count(*) as n from public.site_payments p
            where p.website_id = p_website_id and p.method is not null
              and (p_livemode is null or p.livemode = p_livemode)
            group by p.method) x), '[]'::jsonb),
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

revoke all on function public.site_payments_list(text, text, text[], timestamptz, timestamptz, boolean, text, boolean, integer, integer, text[], text[]) from public, anon;
revoke all on function public.site_payment_detail(uuid) from public, anon;
revoke all on function public.site_payments_export(text, text[], timestamptz, timestamptz, boolean, text[], text[]) from public, anon;
revoke all on function public.site_payments_summary(text, integer, boolean) from public, anon;
grant execute on function public.site_payments_list(text, text, text[], timestamptz, timestamptz, boolean, text, boolean, integer, integer, text[], text[]) to authenticated;
grant execute on function public.site_payment_detail(uuid) to authenticated;
grant execute on function public.site_payments_export(text, text[], timestamptz, timestamptz, boolean, text[], text[]) to authenticated;
grant execute on function public.site_payments_summary(text, integer, boolean) to authenticated;
