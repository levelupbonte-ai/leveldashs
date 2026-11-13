-- Human demo, paid (levelup-ecosystem.com "Start a project").
--
-- A visitor who describes a project chooses between a free AI demo in
-- LevelStudio and a demo made by a person at LevelUp: 19 USD, non-refundable,
-- paid on a Square payment link. Once paid, the visitor follows the demo like a
-- delivery on a tracking page (levelup-ecosystem.com/suivi/<code>?k=<token>):
-- status, timeline, the AI estimate (3 days minimum) and, when it is ready, the
-- demo link. LevelUp moves the status from the dashboard (Project requests).
--
-- Flow:
--   1. showcase, right after submit_project_request: project_demo_start(id,
--      qualify token) -> tracking code + token (kept in private, never listed);
--   2. record_project_qualification also stores the AI estimate (min/max days);
--   3. dashboard /api/demo/checkout?c=<code>&k=<token> (no session, billing key):
--      demo_checkout_prepare -> Square payment link -> demo_checkout_record;
--   4. Square webhook -> demo_ingest_square (billing key): checks order, amount
--      and currency, marks it paid, sets the earliest ready date;
--   5. owners/admins of the LevelUp website: site_demo_update (status, message
--      to the client, demo link, ready date), each change kept in the timeline;
--   6. anyone with code + token: demo_tracking (read only, rate limited).

-- @part 1: columns, tracking, timeline -----------------------------------------

alter table public.project_requests
  add column if not exists demo_status text check (demo_status in (
    'awaiting_payment', 'paid', 'analysis', 'design', 'build', 'final_check', 'ready', 'cancelled')),
  add column if not exists demo_price integer check (demo_price between 0 and 100000000),
  add column if not exists demo_currency text check (demo_currency ~ '^[a-z]{3}$'),
  add column if not exists demo_paid_at timestamptz,
  add column if not exists demo_payment_ref text check (char_length(demo_payment_ref) <= 255),
  add column if not exists demo_url text check (char_length(demo_url) <= 500),
  add column if not exists demo_ready_by date,
  add column if not exists estimate_min_days integer check (estimate_min_days between 3 and 90),
  add column if not exists estimate_max_days integer check (estimate_max_days between 3 and 90),
  add column if not exists estimate_note text check (char_length(estimate_note) <= 300);

create index if not exists project_requests_demo_status_idx
  on public.project_requests (demo_status, created_at desc) where demo_status is not null;

create table if not exists private.project_demo_tracking (
  request_id uuid primary key references public.project_requests (id) on delete cascade,
  code text not null unique check (code ~ '^LU-[A-HJ-NP-Z2-9]{6}$'),
  token text not null check (token ~ '^[0-9a-f]{32}$'),
  link_id text check (char_length(link_id) <= 255),
  order_id text check (char_length(order_id) <= 255),
  attempt integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists project_demo_tracking_order_idx
  on private.project_demo_tracking (order_id) where order_id is not null;

create table if not exists private.project_demo_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.project_requests (id) on delete cascade,
  status text not null,
  message text check (char_length(message) <= 600),
  provider_event_id text unique check (char_length(provider_event_id) <= 255),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index if not exists project_demo_events_request_idx
  on private.project_demo_events (request_id, created_at);

-- 19 USD, the one place the price lives.
create or replace function private.demo_price()
returns table (amount integer, currency text)
language sql
immutable
set search_path = ''
as $$ select 1900, 'usd'; $$;

-- @part 2: tracking code at submit ---------------------------------------------

create or replace function public.project_demo_start(p_id uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  v_token text := encode(extensions.gen_random_bytes(16), 'hex');
  v_try integer := 0;
  i integer;
begin
  if p_id is null or p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    raise exception 'invalid token' using errcode = 'PT403';
  end if;
  perform 1 from private.project_request_tokens t
  where t.request_id = p_id and t.used_at is null and t.expires_at > now()
    and t.token_hash = extensions.digest(p_token, 'sha256');
  if not found then
    raise exception 'invalid token' using errcode = 'PT403';
  end if;
  if exists (select 1 from private.project_demo_tracking where request_id = p_id) then
    raise exception 'already started' using errcode = 'PT409';
  end if;
  loop
    v_bytes := extensions.gen_random_bytes(6);
    v_code := 'LU-';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    begin
      insert into private.project_demo_tracking (request_id, code, token) values (p_id, v_code, v_token);
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 5 then raise; end if;
    end;
  end loop;
  return jsonb_build_object('code', v_code, 'token', v_token);
end;
$$;

-- @part 3: the AI estimate, stored with the qualification ----------------------

do $patch$
declare
  v_def text := pg_get_functiondef('public.record_project_qualification(uuid,text,jsonb)'::regprocedure);
  v_anchor constant text := 'ai_model = private.clean_line(r ->> ''model'', 80)';
begin
  if position('estimate_min_days' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'record_project_qualification: anchor not found';
  end if;
  v_def := replace(v_def, v_anchor, v_anchor || $add$,
      estimate_min_days = case when jsonb_typeof(r -> 'estimate' -> 'min_days') = 'number'
        then least(greatest(round((r -> 'estimate' ->> 'min_days')::numeric)::int, 3), 60) end,
      estimate_max_days = case when jsonb_typeof(r -> 'estimate' -> 'max_days') = 'number'
        then least(greatest(round((r -> 'estimate' ->> 'max_days')::numeric)::int,
          greatest(coalesce(round((r -> 'estimate' ->> 'min_days')::numeric)::int, 3), 3)), 90) end,
      estimate_note = private.clean_line(r -> 'estimate' ->> 'note', 300)$add$);
  execute v_def;
end;
$patch$;

-- @part 4: payment --------------------------------------------------------------

create or replace function private.demo_by_code(p_code text, p_token text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.request_id from private.project_demo_tracking t
  where p_code ~ '^LU-[A-HJ-NP-Z2-9]{6}$' and p_token ~ '^[0-9a-f]{32}$'
    and t.code = p_code and t.token = p_token;
$$;

create or replace function public.demo_checkout_prepare(p_key text, p_code text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  r public.project_requests;
  t private.project_demo_tracking;
  v_price record;
begin
  perform private.assert_billing_key(p_key);
  v_id := private.demo_by_code(p_code, p_token);
  if v_id is null then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  perform private.hit_rate_limit('demo_checkout', p_code, 20, interval '1 hour');
  select * into r from public.project_requests where id = v_id for update;
  select * into t from private.project_demo_tracking where request_id = v_id;
  select * into v_price from private.demo_price();
  if r.demo_status is null then
    update public.project_requests
    set demo_status = 'awaiting_payment', demo_price = v_price.amount, demo_currency = v_price.currency,
        status = case when status = 'new' then 'demo' else status end
    where id = v_id returning * into r;
  end if;
  return jsonb_build_object(
    'request_id', r.id, 'code', t.code, 'paid', r.demo_paid_at is not null,
    'demo_status', r.demo_status, 'amount', r.demo_price, 'currency', r.demo_currency,
    'link_id', t.link_id, 'attempt', t.attempt, 'email', r.email, 'name', r.name,
    'locale', coalesce(r.locale, 'en'), 'business_name', r.business_name);
end;
$$;

create or replace function public.demo_checkout_record(p_key text, p_code text, p_token text,
  p_link_id text, p_order_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.assert_billing_key(p_key);
  v_id := private.demo_by_code(p_code, p_token);
  if v_id is null then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if p_link_id !~ '^[A-Za-z0-9_-]{8,255}$' or p_order_id !~ '^[A-Za-z0-9_-]{8,255}$' then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  update private.project_demo_tracking
  set link_id = p_link_id, order_id = p_order_id, attempt = attempt + 1
  where request_id = v_id;
end;
$$;

-- A new link after the previous one expired or was closed.
create or replace function public.demo_checkout_restart(p_key text, p_code text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.assert_billing_key(p_key);
  v_id := private.demo_by_code(p_code, p_token);
  if v_id is null then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  update private.project_demo_tracking set link_id = null, order_id = null
  where request_id = v_id
    and not exists (select 1 from public.project_requests where id = v_id and demo_paid_at is not null);
end;
$$;

create or replace function public.demo_ingest_square(p_key text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id text := p_event ->> 'event_id';
  v_order text := p_event ->> 'order_id';
  v_payment text := p_event ->> 'payment_id';
  v_status text := p_event ->> 'payment_status';
  v_amount bigint := case when jsonb_typeof(p_event -> 'amount') = 'number'
    then (p_event ->> 'amount')::numeric::bigint end;
  v_currency text := lower(nullif(p_event ->> 'currency', ''));
  t private.project_demo_tracking;
  r public.project_requests;
  v_ready date;
begin
  perform private.assert_billing_key(p_key);
  if v_event_id is null or v_event_id !~ '^[A-Za-z0-9_-]{8,255}$'
     or v_order is null or v_order !~ '^[A-Za-z0-9_-]{8,255}$'
     or v_payment is null or v_payment !~ '^[A-Za-z0-9_-]{8,255}$' then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  select * into t from private.project_demo_tracking where order_id = v_order;
  if not found then
    return jsonb_build_object('status', 'unknown_order');
  end if;
  select * into r from public.project_requests where id = t.request_id for update;
  if r.demo_paid_at is not null then
    return jsonb_build_object('status', 'already_paid');
  end if;
  if coalesce(v_status, '') <> 'COMPLETED' then
    return jsonb_build_object('status', 'not_completed');
  end if;
  if v_amount is null or v_amount < r.demo_price or v_currency is distinct from r.demo_currency then
    perform private.hq_log('demo.payment_mismatch', 'project_request', r.id::text,
      jsonb_build_object('amount', v_amount, 'currency', v_currency));
    return jsonb_build_object('status', 'mismatch');
  end if;

  v_ready := (now() at time zone 'America/Toronto')::date + greatest(coalesce(r.estimate_min_days, 3), 3);
  update public.project_requests
  set demo_paid_at = now(), demo_payment_ref = v_payment, demo_status = 'paid', demo_ready_by = v_ready
  where id = r.id returning * into r;
  insert into private.project_demo_events (request_id, status, provider_event_id)
  values (r.id, 'paid', v_event_id)
  on conflict (provider_event_id) do nothing;
  perform private.hq_log('demo.paid', 'project_request', r.id::text,
    jsonb_build_object('amount', v_amount, 'currency', v_currency, 'code', t.code));
  return jsonb_build_object('status', 'paid', 'code', t.code, 'token', t.token,
    'email', r.email, 'name', r.name, 'locale', coalesce(r.locale, 'en'),
    'business_name', r.business_name, 'project_type', r.project_type,
    'ready_by', r.demo_ready_by, 'estimate_min_days', r.estimate_min_days,
    'estimate_max_days', r.estimate_max_days);
end;
$$;

-- @part 5: LevelUp moves the demo along -----------------------------------------

create or replace function public.site_demo_update(p_website_id text, p_id uuid, p_status text,
  p_message text default null, p_demo_url text default null, p_ready_by date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.owned_source_org(p_website_id, 'project_requests', 'admin');
  v_message text;
  v_url text;
  r public.project_requests;
  t private.project_demo_tracking;
begin
  if v_org is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.assert_mfa();
  if p_status is null or p_status not in ('paid', 'analysis', 'design', 'build', 'final_check', 'ready', 'cancelled') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  v_message := private.check_text(p_message, 600, 'message', true);
  v_url := private.check_url(p_demo_url, 500, 'demo link');
  if p_ready_by is not null and (p_ready_by < current_date - 1 or p_ready_by > current_date + 365) then
    raise exception 'invalid_dates' using errcode = '22023';
  end if;
  select * into r from public.project_requests where id = p_id for update;
  if not found then raise exception 'not found' using errcode = 'PT404'; end if;
  if r.demo_paid_at is null then
    raise exception 'demo_not_paid' using errcode = 'PT409';
  end if;
  if p_status = 'ready' and coalesce(v_url, r.demo_url) is null then
    raise exception 'demo_url_required' using errcode = '22023';
  end if;
  update public.project_requests
  set demo_status = p_status,
      demo_url = coalesce(v_url, demo_url),
      demo_ready_by = coalesce(p_ready_by, demo_ready_by),
      status = case when p_status = 'ready' and status in ('new', 'contacted', 'demo') then 'demo' else status end,
      reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_id returning * into r;
  insert into private.project_demo_events (request_id, status, message, created_by)
  values (p_id, p_status, v_message, (select auth.uid()));
  perform private.site_audit(p_website_id, v_org, 'project_request.demo_status', p_id::text,
    jsonb_build_object('status', p_status));
  select * into t from private.project_demo_tracking where request_id = p_id;
  return jsonb_build_object('code', t.code, 'token', t.token, 'email', r.email, 'name', r.name,
    'locale', coalesce(r.locale, 'en'), 'business_name', r.business_name,
    'status', r.demo_status, 'message', v_message, 'demo_url', r.demo_url, 'ready_by', r.demo_ready_by);
end;
$$;

-- @part 6: the client's tracking page --------------------------------------------

create or replace function public.demo_tracking(p_code text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  r public.project_requests;
begin
  if p_code is null or p_code !~ '^LU-[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  perform private.hit_rate_limit('demo_tracking', p_code, 240, interval '1 hour');
  v_id := private.demo_by_code(p_code, p_token);
  if v_id is null then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  select * into r from public.project_requests where id = v_id;
  return jsonb_build_object(
    'code', p_code,
    'business_name', r.business_name,
    'project_type', r.project_type,
    'locale', coalesce(r.locale, 'en'),
    'status', coalesce(r.demo_status, 'awaiting_payment'),
    'paid_at', r.demo_paid_at,
    'amount', r.demo_price, 'currency', r.demo_currency,
    'ready_by', r.demo_ready_by,
    'estimate', case when r.estimate_min_days is null then null else jsonb_build_object(
      'min_days', r.estimate_min_days, 'max_days', coalesce(r.estimate_max_days, r.estimate_min_days),
      'note', r.estimate_note) end,
    'demo_url', case when r.demo_status = 'ready' then r.demo_url end,
    'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'message', e.message,
        'at', e.created_at) order by e.created_at)
      from private.project_demo_events e where e.request_id = v_id), '[]'::jsonb));
end;
$$;

-- @part 7: the dashboard list shows the demo -------------------------------------

do $patch$
declare
  v_def text := pg_get_functiondef(
    'public.site_project_requests_list(text,text[],text,text,integer,integer)'::regprocedure);
  v_anchor constant text := '''masked'', not v_pii)';
begin
  if position('demo_status' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'site_project_requests_list: anchor not found';
  end if;
  v_def := replace(v_def, v_anchor, $add$'demo', case when f.demo_status is null then null else jsonb_build_object(
             'status', f.demo_status, 'paid_at', f.demo_paid_at, 'amount', f.demo_price, 'currency', f.demo_currency,
             'ready_by', f.demo_ready_by, 'url', f.demo_url,
             'code', (select t.code from private.project_demo_tracking t where t.request_id = f.id),
             'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'message', e.message, 'at', e.created_at)
               order by e.created_at) from private.project_demo_events e where e.request_id = f.id), '[]'::jsonb)) end,
           'estimate', case when f.estimate_min_days is null then null else jsonb_build_object(
             'min_days', f.estimate_min_days, 'max_days', f.estimate_max_days, 'note', f.estimate_note) end,
           $add$ || v_anchor);
  execute v_def;
end;
$patch$;

-- @part 8: grants ----------------------------------------------------------------

revoke all on table private.project_demo_tracking, private.project_demo_events from public, anon, authenticated;
revoke all on function private.demo_price(), private.demo_by_code(text, text) from public, anon, authenticated;
revoke all on function public.project_demo_start(uuid, text), public.demo_checkout_prepare(text, text, text),
  public.demo_checkout_record(text, text, text, text, text), public.demo_checkout_restart(text, text, text),
  public.demo_ingest_square(text, jsonb), public.site_demo_update(text, uuid, text, text, text, date),
  public.demo_tracking(text, text) from public;
-- Showcase (publishable key) and the dashboard's server calls without a session.
grant execute on function public.project_demo_start(uuid, text), public.demo_tracking(text, text),
  public.demo_checkout_prepare(text, text, text), public.demo_checkout_record(text, text, text, text, text),
  public.demo_checkout_restart(text, text, text), public.demo_ingest_square(text, jsonb)
  to anon, authenticated;
grant execute on function public.site_demo_update(text, uuid, text, text, text, date) to authenticated;
