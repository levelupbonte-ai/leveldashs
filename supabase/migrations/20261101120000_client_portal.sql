-- Client portal ("Espace client"): a private space on a client website where
-- the website's paying customers read what the business publishes for them
-- (updates, trip details, documents, checklists) and write back.
--
-- Who is who
-- - Customers are NOT accounts of the ecosystem's shared sign-in. They are rows
--   of portal_customers (one per website + e-mail), created when a payment for
--   that website is recorded as paid (site_ingest_payment -> trigger) or when an
--   owner / admin / editor invites them from the dashboard.
-- - They sign in on the website with a 6-digit code sent by e-mail (10 minutes,
--   single use, replaced by a newer code, 5 wrong tries at most) or, once they
--   chose one, a password (bcrypt). Codes, passwords and session tokens are
--   stored as hashes only, in the private schema (not exposed by the Data API).
-- - The website's server is the only caller of the customer functions: it
--   authenticates with a server key that has the `portal:access` scope (kept in
--   its environment, never in a browser) and passes the customer's session
--   token. The website sends the e-mails itself (codes are returned to that
--   server once, to be e-mailed) and drains the e-mail queue (portal_outbox_*).
-- - Owners, admins and editors of the organization manage the portal from the
--   dashboard (portal_admin_* functions, audited in site_audit_log). Viewers and
--   other organizations can do nothing.
--
-- Documents live in the private bucket `portal-documents`. A customer never
-- reads Storage directly: portal_document_ticket opens a 60-second ticket for one
-- object after checking the customer may see it, and the website's server then
-- asks Storage for a 60-second signed URL; the anon sign policy only matches the
-- sign operation of an object with an open ticket (no listing, no download).

-- ---------------------------------------------------------------- feature + key scope

insert into public.features (key, name, description, is_active, sort_order)
values ('client_portal', 'Client portal',
        'Private space for paying customers: updates, trip details, documents, checklists and messages',
        true, 180)
on conflict (key) do nothing;

insert into public.website_features (website_id, organization_id, feature_key, enabled, config)
select w.id, w.organization_id, 'client_portal', true,
       jsonb_build_object('notify_url', 'https://blackpater.com/api/portal/outbox')
from public.websites w
where w.id = 'ws_ab9493c5857ed460'
on conflict (website_id, feature_key) do nothing;

alter table public.site_api_keys drop constraint if exists site_api_keys_scopes_check;
alter table public.site_api_keys add constraint site_api_keys_scopes_check check (
  cardinality(scopes) between 1 and 8
  and scopes <@ array['payments:write', 'events:write', 'portal:access']::text[]);

create or replace function public.site_create_api_key(
  p_website_id text,
  p_name text,
  p_mode text default 'live',
  p_scopes text[] default array['payments:write']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_name text; v_scopes text[]; v_prefix text; v_secret text; v_key text; v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated' using errcode = 'PT401'; end if;
  select organization_id into v_org from public.websites where id = p_website_id and status <> 'archived';
  if v_org is null or not private.has_org_role(v_org, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.assert_mfa();
  perform private.assert_org_unlocked(v_org);
  v_name := private.check_text(p_name, 80, 'name');
  if v_name is null then raise exception 'A name is required' using errcode = '22023'; end if;
  if p_mode is null or p_mode not in ('live', 'test') then raise exception 'Invalid mode' using errcode = '22023'; end if;
  select array_agg(distinct s order by s) into v_scopes from unnest(p_scopes) as s;
  if v_scopes is null or cardinality(v_scopes) = 0
     or not (v_scopes <@ array['payments:write', 'events:write', 'portal:access']::text[]) then
    raise exception 'Invalid scopes' using errcode = '22023';
  end if;
  if (select count(*) from public.site_api_keys where website_id = p_website_id and revoked_at is null) >= 10 then
    raise exception 'Too many active keys' using errcode = 'PT409';
  end if;
  perform private.hit_rate_limit('site_api_key_create', (select auth.uid())::text, 20, interval '1 hour');
  v_prefix := 'lu_' || p_mode || '_';
  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  v_key := v_prefix || v_secret;
  insert into public.site_api_keys (website_id, organization_id, name, prefix, key_hint, key_hash, scopes, created_by)
  values (p_website_id, v_org, v_name, v_prefix, right(v_secret, 4), encode(extensions.digest(v_key, 'sha256'), 'hex'), v_scopes, (select auth.uid()))
  returning id into v_id;
  perform private.site_audit(p_website_id, v_org, 'api_key.created', v_id::text,
    jsonb_build_object('name', v_name, 'prefix', v_prefix, 'key_hint', right(v_secret, 4), 'scopes', to_jsonb(v_scopes)));
  return jsonb_build_object('id', v_id, 'key', v_key, 'prefix', v_prefix, 'key_hint', right(v_secret, 4));
end;
$$;

-- ---------------------------------------------------------------- tables

create table if not exists public.portal_customers (
  id uuid primary key default gen_random_uuid(),
  website_id text not null,
  organization_id uuid not null,
  email text not null check (email = lower(email) and char_length(email) between 6 and 254),
  -- Every address this customer verified (payments are matched on any of them).
  payment_emails text[] not null default '{}'::text[] check (cardinality(payment_emails) <= 10),
  name text check (name is null or char_length(name) <= 120),
  locale text not null default 'en' check (locale in ('en', 'fr')),
  source text not null check (source in ('payment', 'invite')),
  -- Offer group chosen by the inviter (paid offers come from site_payments).
  offer_id text check (offer_id is null or offer_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  invited_by uuid references auth.users (id) on delete set null,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, email),
  unique (id, website_id),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create table if not exists public.portal_items (
  id uuid primary key default gen_random_uuid(),
  website_id text not null,
  organization_id uuid not null,
  kind text not null check (kind in ('update', 'trip', 'document', 'checklist')),
  audience text not null check (audience in ('customer', 'offer', 'all')),
  customer_id uuid,
  offer_id text check (offer_id is null or offer_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'),
  title text not null check (char_length(title) between 1 and 160),
  body text check (body is null or char_length(body) <= 8000),
  trip jsonb check (trip is null or (jsonb_typeof(trip) = 'object' and pg_column_size(trip) <= 16000)),
  checklist jsonb check (checklist is null or (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) between 1 and 50)),
  document_path text check (document_path is null or char_length(document_path) <= 300),
  document_name text check (document_name is null or char_length(document_name) <= 160),
  document_size bigint,
  document_type text,
  status text not null default 'published' check (status in ('published', 'archived')),
  published_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((audience = 'customer') = (customer_id is not null)),
  check ((audience = 'offer') = (offer_id is not null)),
  check ((kind = 'document') = (document_path is not null)),
  check (kind <> 'trip' or trip is not null),
  check (kind <> 'checklist' or checklist is not null),
  foreign key (customer_id, website_id) references public.portal_customers (id, website_id) on delete cascade,
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create index if not exists portal_items_site_idx on public.portal_items (website_id, published_at desc);
create index if not exists portal_items_customer_idx on public.portal_items (customer_id) where customer_id is not null;

create table if not exists public.portal_item_states (
  item_id uuid not null references public.portal_items (id) on delete cascade,
  customer_id uuid not null references public.portal_customers (id) on delete cascade,
  organization_id uuid not null,
  read_at timestamptz,
  checked smallint[] not null default '{}'::smallint[] check (cardinality(checked) <= 50),
  updated_at timestamptz not null default now(),
  primary key (item_id, customer_id)
);

create table if not exists public.portal_messages (
  id uuid primary key default gen_random_uuid(),
  website_id text not null,
  organization_id uuid not null,
  customer_id uuid not null,
  sender text not null check (sender in ('customer', 'owner')),
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  -- Read by the other side (the owner for customer messages, and back).
  read_at timestamptz,
  foreign key (customer_id, website_id) references public.portal_customers (id, website_id) on delete cascade,
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create index if not exists portal_messages_thread_idx on public.portal_messages (customer_id, created_at);

drop trigger if exists portal_customers_updated_at on public.portal_customers;
create trigger portal_customers_updated_at before update on public.portal_customers
  for each row execute function private.set_updated_at();
drop trigger if exists portal_items_updated_at on public.portal_items;
create trigger portal_items_updated_at before update on public.portal_items
  for each row execute function private.set_updated_at();

-- Private: never reachable through the Data API.
create table if not exists private.portal_codes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.portal_customers (id) on delete cascade,
  purpose text not null check (purpose in ('sign_in', 'password', 'email_old', 'email_new')),
  target_email text not null,
  code_hash text not null,
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  superseded_at timestamptz
);
create index if not exists portal_codes_live_idx on private.portal_codes (customer_id, purpose, created_at desc);

create table if not exists private.portal_passwords (
  customer_id uuid primary key references public.portal_customers (id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.portal_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.portal_customers (id) on delete cascade,
  token_hash text not null unique,
  method text not null check (method in ('code', 'password')),
  device text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists portal_sessions_customer_idx on private.portal_sessions (customer_id);

create table if not exists private.portal_outbox (
  id bigint generated always as identity primary key,
  website_id text not null,
  customer_id uuid not null references public.portal_customers (id) on delete cascade,
  kind text not null check (kind in ('access', 'update', 'message', 'signin')),
  item_id uuid references public.portal_items (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts smallint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);
create index if not exists portal_outbox_pending_idx on private.portal_outbox (website_id, status, created_at);

create table if not exists private.portal_download_tickets (
  id bigint generated always as identity primary key,
  object_path text not null,
  customer_id uuid not null references public.portal_customers (id) on delete cascade,
  item_id uuid not null references public.portal_items (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists portal_download_tickets_path_idx on private.portal_download_tickets (object_path, expires_at);

alter table private.portal_codes enable row level security;
alter table private.portal_passwords enable row level security;
alter table private.portal_sessions enable row level security;
alter table private.portal_outbox enable row level security;
alter table private.portal_download_tickets enable row level security;
revoke all on private.portal_codes, private.portal_passwords, private.portal_sessions,
  private.portal_outbox, private.portal_download_tickets from public, anon, authenticated;

-- ---------------------------------------------------------------- RLS (dashboard reads)

alter table public.portal_customers enable row level security;
alter table public.portal_items enable row level security;
alter table public.portal_item_states enable row level security;
alter table public.portal_messages enable row level security;
revoke all on public.portal_customers, public.portal_items, public.portal_item_states,
  public.portal_messages from public, anon, authenticated;
grant select on public.portal_customers, public.portal_items, public.portal_item_states,
  public.portal_messages to authenticated;

drop policy if exists portal_customers_editor_read on public.portal_customers;
create policy portal_customers_editor_read on public.portal_customers for select to authenticated
  using (private.has_org_role(organization_id, 'editor'));
drop policy if exists portal_items_editor_read on public.portal_items;
create policy portal_items_editor_read on public.portal_items for select to authenticated
  using (private.has_org_role(organization_id, 'editor'));
drop policy if exists portal_item_states_editor_read on public.portal_item_states;
create policy portal_item_states_editor_read on public.portal_item_states for select to authenticated
  using (private.has_org_role(organization_id, 'editor'));
drop policy if exists portal_messages_editor_read on public.portal_messages;
create policy portal_messages_editor_read on public.portal_messages for select to authenticated
  using (private.has_org_role(organization_id, 'editor'));

-- ---------------------------------------------------------------- helpers

create or replace function private.portal_enabled(p_website_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.website_features f
    join public.websites w on w.id = f.website_id
    join public.organizations o on o.id = w.organization_id
    where f.website_id = p_website_id and f.feature_key = 'client_portal' and f.enabled
      and w.status <> 'archived' and o.status <> 'archived');
$$;

-- Website of a server key with the portal scope. PT401 bad / revoked key,
-- PT403 missing scope, PT404 portal not enabled.
create or replace function private.portal_key_website(p_key text)
returns table (website_id text, organization_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid; v_site text; v_org uuid; v_scopes text[]; v_revoked timestamptz;
begin
  if p_key is null or p_key !~ '^lu_(live|test)_[0-9a-f]{48}$' then
    raise exception 'Invalid key' using errcode = 'PT401';
  end if;
  select k.id, k.website_id, k.organization_id, k.scopes, k.revoked_at
  into v_id, v_site, v_org, v_scopes, v_revoked
  from public.site_api_keys k
  where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');
  if v_id is null or v_revoked is not null then
    raise exception 'Invalid key' using errcode = 'PT401';
  end if;
  if not ('portal:access' = any (v_scopes)) then
    raise exception 'This key is not allowed to do that' using errcode = 'PT403';
  end if;
  if not private.portal_enabled(v_site) then
    raise exception 'Client portal not enabled' using errcode = 'PT404';
  end if;
  update public.site_api_keys set last_used_at = now()
  where id = v_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return query select v_site, v_org;
end;
$$;

create or replace function private.portal_clean_email(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_email, '')));
begin
  if not private.is_valid_email(v) then
    raise exception 'Invalid email' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Offers a customer belongs to: paid payments on any verified address + the
-- offer chosen at invitation.
create or replace function private.portal_customer_offers(p_customer_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct o) filter (where o is not null), '{}'::text[])
  from (
    select p.offer_id as o
    from public.portal_customers c
    join public.site_payments p
      on p.website_id = c.website_id
     and lower(p.customer_email) = any (c.payment_emails || c.email)
     and p.status = 'paid'
    where c.id = p_customer_id
    union all
    select c.offer_id from public.portal_customers c where c.id = p_customer_id
  ) x;
$$;

create or replace function private.portal_item_visible(p_item public.portal_items, p_customer_id uuid, p_offers text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_item.status = 'published'
    and (p_item.audience = 'all'
      or (p_item.audience = 'customer' and p_item.customer_id = p_customer_id)
      or (p_item.audience = 'offer' and p_item.offer_id = any (p_offers)));
$$;

-- Customer of a session token on the key's website. PT401 when the session is
-- unknown, expired, revoked, or the customer was revoked.
create or replace function private.portal_session(p_key text, p_session text)
returns public.portal_customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text; v_org uuid; v_sid uuid; v_seen timestamptz; c public.portal_customers;
begin
  select website_id, organization_id into v_site, v_org from private.portal_key_website(p_key);
  if p_session is null or p_session !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid session' using errcode = 'PT401';
  end if;
  select s.id, s.last_seen_at into v_sid, v_seen
  from private.portal_sessions s
  join public.portal_customers cu on cu.id = s.customer_id
  where s.token_hash = private.sha256_hex(p_session)
    and s.revoked_at is null and s.expires_at > now()
    and cu.website_id = v_site and cu.status = 'active';
  if v_sid is null then
    raise exception 'Invalid session' using errcode = 'PT401';
  end if;
  select cu.* into c from public.portal_customers cu
  join private.portal_sessions s on s.customer_id = cu.id where s.id = v_sid;
  if v_seen < now() - interval '5 minutes' then
    update private.portal_sessions set last_seen_at = now() where id = v_sid;
  end if;
  return c;
end;
$$;

-- New 6-digit code for one purpose; older live codes of that purpose stop working.
create or replace function private.portal_new_code(p_customer_id uuid, p_purpose text, p_target text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text; v_id uuid := gen_random_uuid();
begin
  update private.portal_codes set superseded_at = now()
  where customer_id = p_customer_id and purpose = p_purpose and used_at is null and superseded_at is null;
  v_code := lpad(((('x' || lpad(encode(extensions.gen_random_bytes(4), 'hex'), 16, '0'))::bit(64)::bigint) % 1000000)::text, 6, '0');
  insert into private.portal_codes (id, customer_id, purpose, target_email, code_hash, expires_at)
  values (v_id, p_customer_id, p_purpose, p_target, private.sha256_hex(v_id::text || ':' || v_code),
          now() + interval '10 minutes');
  return v_code;
end;
$$;

-- Checks a code; a wrong code counts as one try (5 at most). Never raises.
create or replace function private.portal_check_code(p_customer_id uuid, p_purpose text, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v private.portal_codes;
begin
  select * into v from private.portal_codes
  where customer_id = p_customer_id and purpose = p_purpose
    and used_at is null and superseded_at is null and expires_at > now() and attempts < 5
  order by created_at desc limit 1;
  if v.id is null then
    return false;
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' or v.code_hash <> private.sha256_hex(v.id::text || ':' || p_code) then
    update private.portal_codes set attempts = attempts + 1 where id = v.id;
    return false;
  end if;
  update private.portal_codes set used_at = now() where id = v.id;
  return true;
end;
$$;

-- Rate limit that answers instead of raising, so the caller can keep the
-- recorded try (a raise would roll it back).
create or replace function private.portal_try(p_bucket text, p_subject text, p_max integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from private.rate_limit_events
      where bucket = p_bucket and subject = p_subject and created_at > now() - p_window) >= p_max then
    return false;
  end if;
  insert into private.rate_limit_events (bucket, subject) values (p_bucket, p_subject);
  return true;
end;
$$;

create or replace function private.portal_open_session(p_customer_id uuid, p_method text, p_device text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires timestamptz := now() + interval '7 days';
  v_device text := nullif(left(private.clean_line(p_device, 200), 80), '');
  c public.portal_customers;
begin
  select * into c from public.portal_customers where id = p_customer_id;
  insert into private.portal_sessions (customer_id, token_hash, method, device, expires_at)
  values (p_customer_id, private.sha256_hex(v_token), p_method, v_device, v_expires);
  update public.portal_customers set last_sign_in_at = now() where id = p_customer_id;
  insert into private.portal_outbox (website_id, customer_id, kind, data)
  values (c.website_id, p_customer_id, 'signin',
          jsonb_build_object('device', v_device, 'method', p_method,
                             'at', to_char(date_trunc('minute', now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"')));
  return jsonb_build_object('ok', true, 'session', v_token, 'expires_at', v_expires);
end;
$$;

-- Password rules shared by every caller (the website also checks breached lists).
create or replace function private.portal_check_password(p_password text, p_email text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_password is null or char_length(p_password) < 10 or octet_length(p_password) > 72 then
    raise exception 'weak_password' using errcode = '22023';
  end if;
  if p_password ~ '^(.)\1*$' or lower(p_password) = lower(coalesce(p_email, ''))
     or position(lower(split_part(coalesce(p_email, ''), '@', 1)) in lower(p_password)) > 0 and char_length(split_part(coalesce(p_email, ''), '@', 1)) >= 4 then
    raise exception 'weak_password' using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.portal_enabled(text), private.portal_key_website(text),
  private.portal_clean_email(text), private.portal_customer_offers(uuid),
  private.portal_item_visible(public.portal_items, uuid, text[]), private.portal_session(text, text),
  private.portal_new_code(uuid, text, text), private.portal_check_code(uuid, text, text),
  private.portal_try(text, text, integer, interval), private.portal_open_session(uuid, text, text),
  private.portal_check_password(text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- customers from payments

create or replace function private.portal_customer_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text; v_id uuid;
begin
  if new.status <> 'paid' or new.customer_email is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'paid' then
    return new;
  end if;
  if not private.portal_enabled(new.website_id) then
    return new;
  end if;
  v_email := lower(btrim(new.customer_email));
  if not private.is_valid_email(v_email) then
    return new;
  end if;
  if exists (select 1 from public.portal_customers
             where website_id = new.website_id and (email = v_email or v_email = any (payment_emails))) then
    return new;
  end if;
  insert into public.portal_customers (website_id, organization_id, email, payment_emails, name, locale, source)
  values (new.website_id, new.organization_id, v_email, array[v_email],
          left(private.clean_line(new.customer_name, 200), 120),
          case when new.metadata ->> 'lang' = 'fr' then 'fr' else 'en' end, 'payment')
  on conflict (website_id, email) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into private.portal_outbox (website_id, customer_id, kind) values (new.website_id, v_id, 'access');
  end if;
  return new;
end;
$$;

revoke all on function private.portal_customer_from_payment() from public, anon, authenticated;

drop trigger if exists site_payments_portal_customer on public.site_payments;
create trigger site_payments_portal_customer
  after insert or update of status on public.site_payments
  for each row execute function private.portal_customer_from_payment();

-- Payments already recorded for portal websites (no e-mail is queued for them).
insert into public.portal_customers (website_id, organization_id, email, payment_emails, name, source)
select distinct on (p.website_id, lower(p.customer_email))
       p.website_id, p.organization_id, lower(p.customer_email), array[lower(p.customer_email)],
       left(p.customer_name, 120), 'payment'
from public.site_payments p
where p.status = 'paid' and p.customer_email is not null
  and private.is_valid_email(lower(p.customer_email))
  and private.portal_enabled(p.website_id)
order by p.website_id, lower(p.customer_email), p.occurred_at
on conflict (website_id, email) do nothing;

-- ---------------------------------------------------------------- customer sign-in (website server)

-- Starts a sign-in (or a password change, p_session set): returns the code to
-- e-mail when there is someone to e-mail, otherwise { send: false }. The answer
-- for an unknown address and a known one differ only in fields the website
-- server keeps to itself; the visitor always sees the same message.
-- Limits: 5 codes per address per hour, 20 per client (hashed IP) per hour,
-- 300 per website per hour (PT429).
create or replace function public.portal_request_code(
  p_key text,
  p_email text,
  p_client text,
  p_lang text default null,
  p_purpose text default 'sign_in',
  p_session text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text; v_org uuid; v_email text; c public.portal_customers; v_code text;
begin
  select website_id, organization_id into v_site, v_org from private.portal_key_website(p_key);
  if p_client is null or p_client !~ '^[0-9a-f]{16,64}$' then
    raise exception 'Invalid client' using errcode = '22023';
  end if;
  if p_purpose = 'password' then
    c := private.portal_session(p_key, p_session);
    v_email := c.email;
  elsif p_purpose = 'sign_in' then
    v_email := private.portal_clean_email(p_email);
  else
    raise exception 'Invalid purpose' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('portal_code_site', v_site, 300, interval '1 hour');
  perform private.hit_rate_limit('portal_code_client', v_site || ':' || p_client, 20, interval '1 hour');
  perform private.hit_rate_limit('portal_code_email', v_site || ':' || private.sha256_hex(v_email), 5, interval '1 hour');

  if p_purpose = 'sign_in' then
    select * into c from public.portal_customers where website_id = v_site and email = v_email and status = 'active';
    if c.id is null then
      return jsonb_build_object('ok', true, 'send', false);
    end if;
    if p_lang in ('en', 'fr') and p_lang <> c.locale then
      update public.portal_customers set locale = p_lang where id = c.id;
      c.locale := p_lang;
    end if;
  end if;
  v_code := private.portal_new_code(c.id, p_purpose, v_email);
  return jsonb_build_object('ok', true, 'send', true, 'email', v_email, 'name', c.name,
                            'locale', c.locale, 'code', v_code, 'purpose', p_purpose, 'expires_in', 600);
end;
$$;

-- Signs in with a code. { ok: false } for any failure (unknown address, wrong,
-- expired, used, replaced or exhausted code). 10 tries per address and 30 per
-- client per hour on top of the 5 tries per code.
create or replace function public.portal_verify_code(
  p_key text, p_email text, p_code text, p_client text, p_device text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text; v_org uuid; v_email text; c public.portal_customers;
begin
  select website_id, organization_id into v_site, v_org from private.portal_key_website(p_key);
  if p_client is null or p_client !~ '^[0-9a-f]{16,64}$' then
    raise exception 'Invalid client' using errcode = '22023';
  end if;
  v_email := private.portal_clean_email(p_email);
  if not private.portal_try('portal_verify_client', v_site || ':' || p_client, 30, interval '1 hour')
     or not private.portal_try('portal_verify_email', v_site || ':' || private.sha256_hex(v_email), 10, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  select * into c from public.portal_customers where website_id = v_site and email = v_email and status = 'active';
  if c.id is null or not private.portal_check_code(c.id, 'sign_in', p_code) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  return private.portal_open_session(c.id, 'code', p_device);
end;
$$;

-- Signs in with a password. Same { ok: false } for an unknown address, a
-- customer without a password and a wrong password (a dummy bcrypt runs so the
-- timing does not tell them apart either).
create or replace function public.portal_password_sign_in(
  p_key text, p_email text, p_password text, p_client text, p_device text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text; v_org uuid; v_email text; c public.portal_customers; v_hash text;
begin
  select website_id, organization_id into v_site, v_org from private.portal_key_website(p_key);
  if p_client is null or p_client !~ '^[0-9a-f]{16,64}$' then
    raise exception 'Invalid client' using errcode = '22023';
  end if;
  v_email := private.portal_clean_email(p_email);
  if not private.portal_try('portal_password_client', v_site || ':' || p_client, 30, interval '1 hour')
     or not private.portal_try('portal_password_email', v_site || ':' || private.sha256_hex(v_email), 10, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  select * into c from public.portal_customers where website_id = v_site and email = v_email and status = 'active';
  select password_hash into v_hash from private.portal_passwords where customer_id = c.id;
  if v_hash is null then
    perform extensions.crypt(coalesce(p_password, ''), '$2a$12$0123456789012345678901uOOd8Ym3XU4f9gD7d4cH0nXHc3Hc5vC');
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if p_password is null or octet_length(p_password) > 72 or extensions.crypt(p_password, v_hash) <> v_hash then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  return private.portal_open_session(c.id, 'password', p_device);
end;
$$;

-- Creates or changes the password: needs a fresh code (purpose 'password').
-- Other sessions are signed out.
create or replace function public.portal_set_password(p_key text, p_session text, p_code text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  perform private.portal_check_password(p_password, c.email);
  if not private.portal_check_code(c.id, 'password', p_code) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  insert into private.portal_passwords (customer_id, password_hash)
  values (c.id, extensions.crypt(p_password, extensions.gen_salt('bf', 12)))
  on conflict (customer_id) do update set password_hash = excluded.password_hash, updated_at = now();
  update private.portal_sessions set revoked_at = now()
  where customer_id = c.id and revoked_at is null and token_hash <> private.sha256_hex(p_session);
  return jsonb_build_object('ok', true);
end;
$$;

-- E-mail change, step 1: codes for the current and the new address.
create or replace function public.portal_email_change_start(p_key text, p_session text, p_new_email text, p_client text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; v_new text;
begin
  c := private.portal_session(p_key, p_session);
  if p_client is null or p_client !~ '^[0-9a-f]{16,64}$' then
    raise exception 'Invalid client' using errcode = '22023';
  end if;
  v_new := private.portal_clean_email(p_new_email);
  perform private.hit_rate_limit('portal_email_change', c.id::text, 3, interval '1 hour');
  perform private.hit_rate_limit('portal_code_client', c.website_id || ':' || p_client, 20, interval '1 hour');
  if v_new = c.email or exists (select 1 from public.portal_customers
                                where website_id = c.website_id and email = v_new) then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;
  return jsonb_build_object('ok', true, 'locale', c.locale, 'name', c.name,
    'old', jsonb_build_object('email', c.email, 'code', private.portal_new_code(c.id, 'email_old', c.email)),
    'new', jsonb_build_object('email', v_new, 'code', private.portal_new_code(c.id, 'email_new', v_new)));
end;
$$;

-- E-mail change, step 2: both codes. Other sessions are signed out; payments
-- stay linked (the old address is kept in payment_emails).
create or replace function public.portal_email_change_confirm(p_key text, p_session text, p_old_code text, p_new_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; v_new text; v_ok_old boolean; v_ok_new boolean;
begin
  c := private.portal_session(p_key, p_session);
  select target_email into v_new from private.portal_codes
  where customer_id = c.id and purpose = 'email_new' and used_at is null and superseded_at is null
    and expires_at > now() and attempts < 5
  order by created_at desc limit 1;
  v_ok_old := private.portal_check_code(c.id, 'email_old', p_old_code);
  v_ok_new := private.portal_check_code(c.id, 'email_new', p_new_code);
  if v_new is null or not v_ok_old or not v_ok_new then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  if exists (select 1 from public.portal_customers where website_id = c.website_id and email = v_new) then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;
  update public.portal_customers
  set email = v_new,
      payment_emails = (select array_agg(distinct e) from unnest(payment_emails || c.email || v_new) e)
  where id = c.id;
  update private.portal_sessions set revoked_at = now()
  where customer_id = c.id and revoked_at is null and token_hash <> private.sha256_hex(p_session);
  return jsonb_build_object('ok', true, 'email', v_new, 'previous_email', c.email);
end;
$$;

-- Signs out this session, or every session of the customer (p_all).
create or replace function public.portal_sign_out(p_key text, p_session text, p_all boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  update private.portal_sessions set revoked_at = now()
  where revoked_at is null
    and (token_hash = private.sha256_hex(p_session) or (coalesce(p_all, false) and customer_id = c.id));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- customer reads / writes

-- Everything the portal shows, for the session's customer only.
create or replace function public.portal_home(p_key text, p_session text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; v_offers text[]; v jsonb;
begin
  c := private.portal_session(p_key, p_session);
  v_offers := private.portal_customer_offers(c.id);
  select jsonb_build_object(
    'customer', jsonb_build_object(
      'name', c.name, 'email', c.email, 'locale', c.locale, 'since', c.created_at,
      'has_password', exists (select 1 from private.portal_passwords where customer_id = c.id),
      'sessions', (select count(*) from private.portal_sessions
                   where customer_id = c.id and revoked_at is null and expires_at > now())),
    'offers', to_jsonb(v_offers),
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
        'checklist', i.checklist, 'published_at', i.published_at,
        'document', case when i.kind = 'document' then jsonb_build_object(
          'name', i.document_name, 'size', i.document_size, 'type', i.document_type) end,
        'read', s.read_at is not null,
        'checked', coalesce(to_jsonb(s.checked), '[]'::jsonb))
        order by i.published_at desc)
      from public.portal_items i
      left join public.portal_item_states s on s.item_id = i.id and s.customer_id = c.id
      where i.website_id = c.website_id and private.portal_item_visible(i, c.id, v_offers)), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body,
                                          'created_at', m.created_at,
                                          'read', m.sender = 'customer' or m.read_at is not null)
                       order by m.created_at)
      from (select * from public.portal_messages where customer_id = c.id
            order by created_at desc limit 200) m), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

create or replace function public.portal_mark_read(p_key text, p_session text, p_item_id uuid default null, p_messages boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; i public.portal_items;
begin
  c := private.portal_session(p_key, p_session);
  if p_item_id is not null then
    select * into i from public.portal_items where id = p_item_id and website_id = c.website_id;
    if i.id is null or not private.portal_item_visible(i, c.id, private.portal_customer_offers(c.id)) then
      raise exception 'Not found' using errcode = 'PT404';
    end if;
    insert into public.portal_item_states (item_id, customer_id, organization_id, read_at)
    values (i.id, c.id, i.organization_id, now())
    on conflict (item_id, customer_id) do update
      set read_at = coalesce(public.portal_item_states.read_at, now());
  end if;
  if coalesce(p_messages, false) then
    update public.portal_messages set read_at = now()
    where customer_id = c.id and sender = 'owner' and read_at is null;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.portal_set_checklist(p_key text, p_session text, p_item_id uuid, p_index integer, p_checked boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; i public.portal_items; v smallint[];
begin
  c := private.portal_session(p_key, p_session);
  select * into i from public.portal_items where id = p_item_id and website_id = c.website_id and kind = 'checklist';
  if i.id is null or not private.portal_item_visible(i, c.id, private.portal_customer_offers(c.id)) then
    raise exception 'Not found' using errcode = 'PT404';
  end if;
  if p_index is null or p_index < 0 or p_index >= jsonb_array_length(i.checklist) then
    raise exception 'Invalid item' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('portal_checklist', c.id::text, 300, interval '1 hour');
  insert into public.portal_item_states (item_id, customer_id, organization_id, read_at)
  values (i.id, c.id, i.organization_id, now())
  on conflict (item_id, customer_id) do nothing;
  update public.portal_item_states
  set checked = case when coalesce(p_checked, false)
                     then (select array_agg(distinct x order by x) from unnest(checked || p_index::smallint) x)
                     else array_remove(checked, p_index::smallint) end,
      read_at = coalesce(read_at, now()), updated_at = now()
  where item_id = i.id and customer_id = c.id
  returning checked into v;
  return jsonb_build_object('ok', true, 'checked', to_jsonb(coalesce(v, '{}'::smallint[])));
end;
$$;

-- A customer's message to the business: 1 to 4000 characters, no HTML;
-- 10 per hour and 30 per day per customer.
create or replace function public.portal_send_message(p_key text, p_session text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; v_body text; v_id uuid; v_at timestamptz;
begin
  c := private.portal_session(p_key, p_session);
  v_body := private.check_text(p_body, 4000, 'message', true);
  if v_body is null then
    raise exception 'Empty message' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('portal_message_hour', c.id::text, 10, interval '1 hour');
  perform private.hit_rate_limit('portal_message_day', c.id::text, 30, interval '1 day');
  insert into public.portal_messages (website_id, organization_id, customer_id, sender, body)
  values (c.website_id, c.organization_id, c.id, 'customer', v_body)
  returning id, created_at into v_id, v_at;
  return jsonb_build_object('ok', true, 'id', v_id, 'created_at', v_at);
end;
$$;

-- Opens a 60-second download ticket for one document the customer may see.
-- The website's server then asks Storage for a 60-second signed URL.
-- 60 per hour per customer.
create or replace function public.portal_document_ticket(p_key text, p_session text, p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; i public.portal_items;
begin
  c := private.portal_session(p_key, p_session);
  select * into i from public.portal_items where id = p_item_id and website_id = c.website_id and kind = 'document';
  if i.id is null or not private.portal_item_visible(i, c.id, private.portal_customer_offers(c.id)) then
    raise exception 'Not found' using errcode = 'PT404';
  end if;
  perform private.hit_rate_limit('portal_download', c.id::text, 60, interval '1 hour');
  insert into private.portal_download_tickets (object_path, customer_id, item_id, expires_at)
  values (i.document_path, c.id, i.id, now() + interval '60 seconds');
  insert into public.portal_item_states (item_id, customer_id, organization_id, read_at)
  values (i.id, c.id, i.organization_id, now())
  on conflict (item_id, customer_id) do update set read_at = coalesce(public.portal_item_states.read_at, now());
  return jsonb_build_object('ok', true, 'bucket', 'portal-documents', 'path', i.document_path,
                            'name', i.document_name, 'expires_in', 60);
end;
$$;

-- Provider references of one of the customer's own payments (receipt lookup by
-- the website's server, which holds the payment provider's key).
create or replace function public.portal_payment_reference(p_key text, p_session text, p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; p public.site_payments;
begin
  c := private.portal_session(p_key, p_session);
  select * into p from public.site_payments
  where id = p_payment_id and website_id = c.website_id
    and lower(customer_email) = any (c.payment_emails || c.email) and status in ('paid', 'refunded');
  if p.id is null then
    raise exception 'Not found' using errcode = 'PT404';
  end if;
  perform private.hit_rate_limit('portal_receipt', c.id::text, 30, interval '1 hour');
  return jsonb_build_object('ok', true, 'provider', p.provider, 'session_id', p.provider_session_id,
                            'payment_intent', p.provider_payment_intent, 'livemode', p.livemode);
end;
$$;

-- ---------------------------------------------------------------- e-mail queue (website server)

-- Claims up to p_limit e-mails to send (pending, or stuck in 'sending' for 10
-- minutes; 5 attempts at most) with what the e-mail needs.
create or replace function public.portal_outbox_claim(p_key text, p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text; v_org uuid; v jsonb;
begin
  select website_id, organization_id into v_site, v_org from private.portal_key_website(p_key);
  with picked as (
    select o.id from private.portal_outbox o
    where o.website_id = v_site and o.attempts < 5
      and (o.status = 'pending' or (o.status = 'sending' and o.claimed_at < now() - interval '10 minutes'))
    order by o.created_at
    limit least(greatest(coalesce(p_limit, 10), 1), 25)
    for update skip locked
  ), upd as (
    update private.portal_outbox o
    set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
    from picked where o.id = picked.id
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'kind', u.kind, 'data', u.data, 'created_at', u.created_at,
      'to', cu.email, 'name', cu.name, 'locale', cu.locale,
      'item', case when it.id is not null then jsonb_build_object('kind', it.kind, 'title', it.title) end)
      order by u.created_at), '[]'::jsonb)
  into v
  from upd u
  join public.portal_customers cu on cu.id = u.customer_id
  left join public.portal_items it on it.id = u.item_id
  where cu.status = 'active';
  -- Revoked customers get nothing.
  update private.portal_outbox o set status = 'failed', last_error = 'revoked'
  from public.portal_customers cu
  where o.customer_id = cu.id and o.website_id = v_site and o.status = 'sending' and cu.status <> 'active';
  return v;
end;
$$;

create or replace function public.portal_outbox_complete(p_key text, p_id bigint, p_ok boolean, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text; v_org uuid;
begin
  select website_id, organization_id into v_site, v_org from private.portal_key_website(p_key);
  update private.portal_outbox
  set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
      sent_at = case when p_ok then now() end,
      last_error = case when p_ok then null else left(regexp_replace(coalesce(p_error, 'error'), '[^a-z0-9_.:-]', '', 'gi'), 60) end
  where id = p_id and website_id = v_site and status = 'sending';
  return jsonb_build_object('ok', found);
end;
$$;

-- ---------------------------------------------------------------- owner side (dashboard)

create or replace function private.portal_manage_site(p_website_id text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  select organization_id into v_org from public.websites where id = p_website_id and status <> 'archived';
  if v_org is null or not private.has_org_role(v_org, 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.portal_enabled(p_website_id) then
    raise exception 'Client portal not enabled' using errcode = 'PT404';
  end if;
  return v_org;
end;
$$;

revoke all on function private.portal_manage_site(text) from public, anon, authenticated;

-- Customers (with payments and offers), published items, queue state.
create or replace function public.portal_admin_overview(p_website_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := private.portal_manage_site(p_website_id);
  return jsonb_build_object(
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'email', c.email, 'name', c.name, 'source', c.source, 'status', c.status,
        'locale', c.locale, 'offer_id', c.offer_id, 'created_at', c.created_at,
        'last_sign_in_at', c.last_sign_in_at,
        'offers', to_jsonb(private.portal_customer_offers(c.id)),
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object('id', p.id, 'offer_id', p.offer_id, 'offer_name', p.offer_name,
                                              'status', p.status, 'amount', p.amount, 'currency', p.currency,
                                              'paid_at', p.paid_at, 'occurred_at', p.occurred_at)
                           order by p.occurred_at desc)
          from public.site_payments p
          where p.website_id = c.website_id and lower(p.customer_email) = any (c.payment_emails || c.email)
            and p.status in ('paid', 'refunded', 'pending')), '[]'::jsonb),
        'unread', (select count(*) from public.portal_messages m
                   where m.customer_id = c.id and m.sender = 'customer' and m.read_at is null),
        'last_message_at', (select max(created_at) from public.portal_messages m where m.customer_id = c.id))
        order by c.created_at desc)
      from public.portal_customers c where c.website_id = p_website_id), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.offer_id, 'name', x.offer_name) order by x.offer_id)
      from (select distinct on (offer_id) offer_id, offer_name from public.site_payments
            where website_id = p_website_id and offer_id is not null
            order by offer_id, occurred_at desc) x), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'audience', i.audience, 'customer_id', i.customer_id,
        'offer_id', i.offer_id, 'title', i.title, 'body', i.body, 'trip', i.trip,
        'checklist', i.checklist, 'document_name', i.document_name, 'document_path', i.document_path,
        'document_size', i.document_size, 'status', i.status, 'published_at', i.published_at,
        'reads', (select count(*) from public.portal_item_states s where s.item_id = i.id and s.read_at is not null))
        order by i.published_at desc)
      from (select * from public.portal_items where website_id = p_website_id
            order by published_at desc limit 200) i), '[]'::jsonb),
    'outbox', (select jsonb_build_object(
        'pending', count(*) filter (where status in ('pending', 'sending')),
        'failed', count(*) filter (where status = 'failed'),
        'sent', count(*) filter (where status = 'sent'))
      from private.portal_outbox where website_id = p_website_id),
    'notify_url', (select config ->> 'notify_url' from public.website_features
                   where website_id = p_website_id and feature_key = 'client_portal'),
    'can_manage', true);
end;
$$;

-- Invites (or re-activates) a customer by e-mail; queues the access e-mail.
-- 50 invitations per website per day.
create or replace function public.portal_admin_invite(
  p_website_id text, p_email text, p_name text default null, p_offer_id text default null, p_locale text default 'en'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_email text; v_name text; c public.portal_customers; v_created boolean := false;
begin
  v_org := private.portal_manage_site(p_website_id);
  perform private.assert_org_unlocked(v_org);
  v_email := private.portal_clean_email(p_email);
  v_name := private.check_text(p_name, 120, 'name');
  if p_offer_id is not null and p_offer_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$' then
    raise exception 'Invalid offer' using errcode = '22023';
  end if;
  if coalesce(p_locale, 'en') not in ('en', 'fr') then
    raise exception 'Invalid locale' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('portal_invite', p_website_id, 50, interval '1 day');
  select * into c from public.portal_customers
  where website_id = p_website_id and (email = v_email or v_email = any (payment_emails));
  if c.id is null then
    insert into public.portal_customers (website_id, organization_id, email, payment_emails, name, locale,
                                         source, offer_id, invited_by)
    values (p_website_id, v_org, v_email, array[v_email], v_name, coalesce(p_locale, 'en'), 'invite',
            p_offer_id, (select auth.uid()))
    returning * into c;
    v_created := true;
  else
    update public.portal_customers
    set status = 'active', name = coalesce(v_name, name), offer_id = coalesce(p_offer_id, offer_id)
    where id = c.id returning * into c;
  end if;
  insert into private.portal_outbox (website_id, customer_id, kind) values (p_website_id, c.id, 'access');
  perform private.site_audit(p_website_id, v_org, 'portal.customer_invited', c.id::text,
    jsonb_build_object('created', v_created, 'offer_id', p_offer_id));
  return jsonb_build_object('ok', true, 'id', c.id, 'created', v_created);
end;
$$;

create or replace function public.portal_admin_set_customer_status(p_customer_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; v_org uuid;
begin
  select * into c from public.portal_customers where id = p_customer_id;
  if c.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_org := private.portal_manage_site(c.website_id);
  perform private.assert_org_unlocked(v_org);
  if p_status not in ('active', 'revoked') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  update public.portal_customers set status = p_status where id = c.id;
  if p_status = 'revoked' then
    update private.portal_sessions set revoked_at = now() where customer_id = c.id and revoked_at is null;
  end if;
  perform private.site_audit(c.website_id, v_org,
    case when p_status = 'revoked' then 'portal.customer_revoked' else 'portal.customer_restored' end,
    c.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Publishes an update, trip, document or checklist to one customer, an offer
-- group or every customer, and queues the "new update" e-mails (p_notify).
create or replace function public.portal_admin_publish(p_website_id text, p_item jsonb, p_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_kind text; v_aud text; v_customer uuid; v_offer text; v_title text; v_body text;
  v_trip jsonb; v_list jsonb; v_path text; v_doc_name text; v_size bigint; v_type text;
  v_id uuid; v_queued integer := 0; v_step jsonb; v_steps jsonb := '[]'::jsonb; v_x jsonb;
begin
  v_org := private.portal_manage_site(p_website_id);
  perform private.assert_org_unlocked(v_org);
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    raise exception 'Invalid item' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('portal_publish', p_website_id, 200, interval '1 day');
  v_kind := p_item ->> 'kind';
  v_aud := p_item ->> 'audience';
  if v_kind is null or v_kind not in ('update', 'trip', 'document', 'checklist') then
    raise exception 'Invalid item: kind' using errcode = '22023';
  end if;
  if v_aud is null or v_aud not in ('customer', 'offer', 'all') then
    raise exception 'Invalid item: audience' using errcode = '22023';
  end if;
  if v_aud = 'customer' then
    v_customer := (p_item ->> 'customer_id')::uuid;
    if not exists (select 1 from public.portal_customers where id = v_customer and website_id = p_website_id) then
      raise exception 'Invalid item: customer' using errcode = '22023';
    end if;
  elsif v_aud = 'offer' then
    v_offer := p_item ->> 'offer_id';
    if v_offer is null or v_offer !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$' then
      raise exception 'Invalid item: offer' using errcode = '22023';
    end if;
  end if;
  v_title := private.check_text(p_item ->> 'title', 160, 'title');
  if v_title is null then
    raise exception 'Invalid item: title' using errcode = '22023';
  end if;
  v_body := private.check_text(p_item ->> 'body', 8000, 'body', true);

  if v_kind = 'trip' then
    v_trip := p_item -> 'trip';
    if v_trip is null or jsonb_typeof(v_trip) <> 'object' then
      raise exception 'Invalid item: trip' using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(v_trip -> 'steps', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(v_trip -> 'steps', '[]'::jsonb)) > 30 then
      raise exception 'Invalid item: steps' using errcode = '22023';
    end if;
    for v_step in select * from jsonb_array_elements(coalesce(v_trip -> 'steps', '[]'::jsonb)) loop
      if jsonb_typeof(v_step) <> 'object' or private.check_text(v_step ->> 'title', 160, 'step') is null then
        raise exception 'Invalid item: step' using errcode = '22023';
      end if;
      if v_step ->> 'date' is not null and v_step ->> 'date' !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Invalid item: step date' using errcode = '22023';
      end if;
      v_steps := v_steps || jsonb_build_object(
        'date', v_step ->> 'date', 'title', private.check_text(v_step ->> 'title', 160, 'step'),
        'detail', private.check_text(v_step ->> 'detail', 1000, 'step detail', true));
    end loop;
    if (v_trip ->> 'start_date' is not null and v_trip ->> 'start_date' !~ '^\d{4}-\d{2}-\d{2}$')
       or (v_trip ->> 'end_date' is not null and v_trip ->> 'end_date' !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception 'Invalid item: dates' using errcode = '22023';
    end if;
    v_trip := jsonb_build_object(
      'start_date', v_trip ->> 'start_date', 'end_date', v_trip ->> 'end_date',
      'meeting_point', private.check_text(v_trip ->> 'meeting_point', 300, 'meeting point', true),
      'meeting_time', private.check_text(v_trip ->> 'meeting_time', 40, 'meeting time'),
      'steps', v_steps);
  elsif v_kind = 'checklist' then
    if jsonb_typeof(p_item -> 'checklist') <> 'array'
       or jsonb_array_length(p_item -> 'checklist') not between 1 and 50 then
      raise exception 'Invalid item: checklist' using errcode = '22023';
    end if;
    v_list := '[]'::jsonb;
    for v_x in select * from jsonb_array_elements(p_item -> 'checklist') loop
      if jsonb_typeof(v_x) <> 'string' or private.check_text(v_x #>> '{}', 160, 'checklist item') is null then
        raise exception 'Invalid item: checklist item' using errcode = '22023';
      end if;
      v_list := v_list || to_jsonb(private.check_text(v_x #>> '{}', 160, 'checklist item'));
    end loop;
  elsif v_kind = 'document' then
    v_path := p_item ->> 'document_path';
    if v_path is null
       or v_path !~ ('^org/' || v_org::text || '/site/' || p_website_id
                     || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$') then
      raise exception 'Invalid item: document' using errcode = '22023';
    end if;
    select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype' into v_size, v_type
    from storage.objects o where o.bucket_id = 'portal-documents' and o.name = v_path;
    if v_type is null then
      raise exception 'Invalid item: document missing' using errcode = '22023';
    end if;
    v_doc_name := coalesce(private.check_text(p_item ->> 'document_name', 160, 'file name'), v_title);
  end if;

  insert into public.portal_items (website_id, organization_id, kind, audience, customer_id, offer_id, title,
                                   body, trip, checklist, document_path, document_name, document_size,
                                   document_type, created_by)
  values (p_website_id, v_org, v_kind, v_aud, v_customer, v_offer, v_title, v_body, v_trip, v_list, v_path,
          v_doc_name, v_size, v_type, (select auth.uid()))
  returning id into v_id;

  if coalesce(p_notify, true) then
    insert into private.portal_outbox (website_id, customer_id, kind, item_id)
    select p_website_id, c.id, 'update', v_id
    from public.portal_customers c
    where c.website_id = p_website_id and c.status = 'active'
      and (v_aud = 'all' or (v_aud = 'customer' and c.id = v_customer)
           or (v_aud = 'offer' and v_offer = any (private.portal_customer_offers(c.id))));
    get diagnostics v_queued = row_count;
  end if;

  perform private.site_audit(p_website_id, v_org, 'portal.item_published', v_id::text,
    jsonb_build_object('kind', v_kind, 'audience', v_aud, 'customer_id', v_customer, 'offer_id', v_offer,
                       'notified', v_queued));
  return jsonb_build_object('ok', true, 'id', v_id, 'notified', v_queued);
end;
$$;

create or replace function public.portal_admin_archive_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.portal_items; v_org uuid;
begin
  select * into i from public.portal_items where id = p_item_id;
  if i.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_org := private.portal_manage_site(i.website_id);
  update public.portal_items set status = 'archived' where id = i.id;
  perform private.site_audit(i.website_id, v_org, 'portal.item_archived', i.id::text,
    jsonb_build_object('kind', i.kind));
  return jsonb_build_object('ok', true);
end;
$$;

-- Thread of one customer; marks the customer's messages as read by the business.
create or replace function public.portal_admin_thread(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  select * into c from public.portal_customers where id = p_customer_id;
  if c.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.portal_manage_site(c.website_id);
  update public.portal_messages set read_at = now()
  where customer_id = c.id and sender = 'customer' and read_at is null;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body,
                                        'created_at', m.created_at, 'read_at', m.read_at)
                     order by m.created_at)
    from public.portal_messages m where m.customer_id = c.id), '[]'::jsonb);
end;
$$;

create or replace function public.portal_admin_reply(p_customer_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; v_org uuid; v_body text; v_id uuid;
begin
  select * into c from public.portal_customers where id = p_customer_id;
  if c.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_org := private.portal_manage_site(c.website_id);
  perform private.assert_org_unlocked(v_org);
  v_body := private.check_text(p_body, 4000, 'message', true);
  if v_body is null then
    raise exception 'Empty message' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('portal_reply', c.website_id, 300, interval '1 day');
  insert into public.portal_messages (website_id, organization_id, customer_id, sender, author_id, body)
  values (c.website_id, v_org, c.id, 'owner', (select auth.uid()), v_body)
  returning id into v_id;
  if c.status = 'active' then
    insert into private.portal_outbox (website_id, customer_id, kind) values (c.website_id, c.id, 'message');
  end if;
  perform private.site_audit(c.website_id, v_org, 'portal.message_sent', c.id::text,
    jsonb_build_object('message_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function
  public.portal_request_code(text, text, text, text, text, text),
  public.portal_verify_code(text, text, text, text, text),
  public.portal_password_sign_in(text, text, text, text, text),
  public.portal_set_password(text, text, text, text),
  public.portal_email_change_start(text, text, text, text),
  public.portal_email_change_confirm(text, text, text, text),
  public.portal_sign_out(text, text, boolean),
  public.portal_home(text, text),
  public.portal_mark_read(text, text, uuid, boolean),
  public.portal_set_checklist(text, text, uuid, integer, boolean),
  public.portal_send_message(text, text, text),
  public.portal_document_ticket(text, text, uuid),
  public.portal_payment_reference(text, text, uuid),
  public.portal_outbox_claim(text, integer),
  public.portal_outbox_complete(text, bigint, boolean, text),
  public.portal_admin_overview(text),
  public.portal_admin_invite(text, text, text, text, text),
  public.portal_admin_set_customer_status(uuid, text),
  public.portal_admin_publish(text, jsonb, boolean),
  public.portal_admin_archive_item(uuid),
  public.portal_admin_thread(uuid),
  public.portal_admin_reply(uuid, text)
  from public;

-- Website server (publishable key + portal server key in p_key).
grant execute on function
  public.portal_request_code(text, text, text, text, text, text),
  public.portal_verify_code(text, text, text, text, text),
  public.portal_password_sign_in(text, text, text, text, text),
  public.portal_set_password(text, text, text, text),
  public.portal_email_change_start(text, text, text, text),
  public.portal_email_change_confirm(text, text, text, text),
  public.portal_sign_out(text, text, boolean),
  public.portal_home(text, text),
  public.portal_mark_read(text, text, uuid, boolean),
  public.portal_set_checklist(text, text, uuid, integer, boolean),
  public.portal_send_message(text, text, text),
  public.portal_document_ticket(text, text, uuid),
  public.portal_payment_reference(text, text, uuid),
  public.portal_outbox_claim(text, integer),
  public.portal_outbox_complete(text, bigint, boolean, text)
  to anon, authenticated;

-- Dashboard (signed-in members; each function checks editor+ itself).
revoke all on function
  public.portal_admin_overview(text),
  public.portal_admin_invite(text, text, text, text, text),
  public.portal_admin_set_customer_status(uuid, text),
  public.portal_admin_publish(text, jsonb, boolean),
  public.portal_admin_archive_item(uuid),
  public.portal_admin_thread(uuid),
  public.portal_admin_reply(uuid, text)
  from anon;
grant execute on function
  public.portal_admin_overview(text),
  public.portal_admin_invite(text, text, text, text, text),
  public.portal_admin_set_customer_status(uuid, text),
  public.portal_admin_publish(text, jsonb, boolean),
  public.portal_admin_archive_item(uuid),
  public.portal_admin_thread(uuid),
  public.portal_admin_reply(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-documents', 'portal-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- org/<org>/site/<website>/<uuid>.<pdf|jpg|png|webp>, website of that org with
-- the portal on, caller editor or above.
create or replace function private.portal_can_manage_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[]; v_org uuid;
begin
  if p_name is null or p_name !~ '^org/[0-9a-f-]{36}/site/ws_[0-9a-f]{16}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$' then
    return false;
  end if;
  v_parts := string_to_array(p_name, '/');
  v_org := private.safe_uuid(v_parts[2]);
  return v_org is not null
    and exists (select 1 from public.websites w where w.id = v_parts[4] and w.organization_id = v_org
                and w.status <> 'archived')
    and private.portal_enabled(v_parts[4])
    and private.has_org_role(v_org, 'editor');
end;
$$;

-- An open download ticket for this exact object.
create or replace function private.portal_ticket_open(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.portal_download_tickets t
                 where t.object_path = p_name and t.expires_at > now());
$$;

revoke all on function private.portal_can_manage_path(text), private.portal_ticket_open(text) from public;
grant execute on function private.portal_can_manage_path(text) to authenticated;
grant execute on function private.portal_ticket_open(text) to anon;

drop policy if exists portal_documents_insert on storage.objects;
create policy portal_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'portal-documents' and private.portal_can_manage_path(name));

drop policy if exists portal_documents_select on storage.objects;
create policy portal_documents_select on storage.objects for select to authenticated
  using (bucket_id = 'portal-documents' and private.portal_can_manage_path(name));

-- The website server signs a URL for a ticketed object; nothing else (no
-- listing, no direct download) matches.
drop policy if exists portal_documents_ticket_sign on storage.objects;
create policy portal_documents_ticket_sign on storage.objects for select to anon
  using (bucket_id = 'portal-documents'
         and storage.allow_only_operation('object.sign')
         and private.portal_ticket_open(name));
