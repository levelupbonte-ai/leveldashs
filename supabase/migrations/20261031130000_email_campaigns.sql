-- Email campaigns: a business owner e-mails its own customers (opted-in only).
--
-- Audience (public.email_contacts, one list per website):
--   * newsletter sign-ups (form type `newsletter`), synced by a trigger on
--     form_submissions and backfilled once here;
--   * CSV imports, only with an explicit consent confirmation that is recorded
--     (public.email_contact_imports: who, when, the statement they confirmed).
--   Per contact: email, name, source, consent date and source, status
--   (subscribed / unsubscribed / bounced / complained) and an unsubscribe token.
--   The token is a keyed hash (HMAC-SHA256 with a random 256-bit key kept in
--   Vault) of the contact id and a version number: unguessable, never stored
--   (only its SHA-256 is), the same in every e-mail sent to that contact so old
--   links keep working, and replaced (version + 1) when the contact signs up
--   again after unsubscribing. It only ever targets its own contact.
--   Nobody who is not `subscribed` is ever selected or sent to.
--
-- Campaigns (public.email_campaigns): draft / scheduled / sending / sent / failed.
--   Editors write drafts; owners and admins (aal2 when enrolled) test, schedule
--   and send. Content is plain text checked here (lengths, no HTML, http(s)
--   button link, image from this website's media library); the HTML is built by
--   the dashboard server with every value escaped.
--
-- Sending (public.email_campaign_recipients): starting a campaign snapshots the
--   subscribed contacts into recipients grouped in batches of 50, after the plan
--   quota (plans.limits.emails_month), the per-site daily cap and the pause
--   switch are checked. A sender claims one batch at a time (lease of 3 minutes,
--   rows locked, contacts re-checked: anyone no longer subscribed is skipped),
--   sends it with an idempotency key per batch, then records the result.
--   Expired leases are claimed again, so a crash never loses or doubles a batch.
--   Senders: the signed-in owner / admin (dashboard routes) or the e-mail worker
--   (cron route, anon role + the e-mail worker key, like the billing webhook key).
--
-- Delivery events (public.email_events): the provider webhook route (signature
--   checked there) records delivered / bounced / complained with the worker key.
--   Hard bounces and complaints change the contact's status. A website whose
--   bounce rate (>= 5 %) or complaint rate (>= 0.3 %) over the last 30 days is
--   too high (100 e-mails sent at least) is paused automatically; LevelUp staff
--   resume it.
--
-- Every mutation is written to site_audit_log (or hq_audit_log for staff) in the
-- same function.

-- @part 1: billing (plan quota emails_month) ------------------------------------

create or replace function private.billing_limit_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['team_members', 'assistant_requests_month', 'media_mb', 'websites', 'emails_month'];
$$;

-- Suggested quotas; staff edit them on the Plans screen (admin_save_plan).
update public.plans p
set limits = p.limits || jsonb_build_object('emails_month', v.quota)
from (values ('free', 500), ('starter', 2500), ('pro', 10000), ('business', 50000)) as v (key, quota)
where p.key = v.key and not (p.limits ? 'emails_month');

-- @part 2: tables ----------------------------------------------------------------

create table if not exists public.email_sender_profiles (
  website_id text primary key,
  organization_id uuid not null,
  from_name text check (from_name is null or char_length(from_name) between 1 and 60),
  reply_to text check (reply_to is null or char_length(reply_to) <= 254),
  postal_address text not null check (char_length(postal_address) between 10 and 300),
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9a-f]{6}$'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create table if not exists public.email_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  website_id text not null,
  email text not null check (char_length(email) between 6 and 254 and email = lower(email)),
  name text check (name is null or char_length(name) <= 120),
  source text not null check (source in ('newsletter', 'import')),
  consent_at timestamptz not null,
  consent_source text not null check (char_length(consent_source) between 1 and 120),
  status text not null default 'subscribed'
    check (status in ('subscribed', 'unsubscribed', 'bounced', 'complained')),
  status_changed_at timestamptz not null default now(),
  token_version integer not null default 1 check (token_version >= 1),
  unsubscribe_token_hash text not null unique check (unsubscribe_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, email),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);
create index if not exists email_contacts_site_status_idx on public.email_contacts (website_id, status, created_at desc);

create table if not exists public.email_contact_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  website_id text not null,
  imported_by uuid references auth.users (id) on delete set null,
  consent_confirmed boolean not null check (consent_confirmed),
  consent_statement text not null check (char_length(consent_statement) between 10 and 500),
  rows_received integer not null default 0,
  rows_added integer not null default 0,
  rows_existing integer not null default 0,
  rows_invalid integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  website_id text not null,
  template text not null default 'newsletter'
    check (template in ('newsletter', 'announcement', 'promotion', 'event', 'letter', 'thank_you')),
  locale text not null default 'en' check (locale in ('en', 'fr')),
  subject text not null default '' check (char_length(subject) <= 120),
  preview_text text not null default '' check (char_length(preview_text) <= 150),
  heading text not null default '' check (char_length(heading) <= 150),
  body text not null default '' check (char_length(body) <= 10000),
  button_label text check (button_label is null or char_length(button_label) <= 40),
  button_url text check (button_url is null or (char_length(button_url) <= 2048 and button_url ~* '^https?://')),
  image_media_id uuid references public.media (id) on delete set null,
  image_path text check (image_path is null or char_length(image_path) <= 300),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  failure_reason text check (failure_reason is null or failure_reason in
    ('quota', 'daily_cap', 'paused', 'sender_missing', 'no_recipients', 'content_missing', 'provider')),
  recipient_count integer not null default 0,
  sender jsonb check (sender is null or (jsonb_typeof(sender) = 'object' and pg_column_size(sender) <= 4000)),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);
create index if not exists email_campaigns_site_idx on public.email_campaigns (website_id, created_at desc);
create index if not exists email_campaigns_due_idx on public.email_campaigns (scheduled_at) where status = 'scheduled';
create index if not exists email_campaigns_sending_idx on public.email_campaigns (started_at) where status = 'sending';

create table if not exists public.email_campaign_recipients (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.email_campaigns (id) on delete cascade,
  organization_id uuid not null,
  website_id text not null,
  contact_id uuid not null references public.email_contacts (id) on delete cascade,
  batch_no integer not null check (batch_no >= 0),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts smallint not null default 0,
  lease_until timestamptz,
  provider_message_id text unique check (provider_message_id is null or provider_message_id ~ '^[A-Za-z0-9_-]{8,100}$'),
  error text check (error is null or char_length(error) <= 80),
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);
create index if not exists email_recipients_batch_idx on public.email_campaign_recipients (campaign_id, batch_no, status);
create index if not exists email_recipients_org_month_idx on public.email_campaign_recipients (organization_id, created_at);
create index if not exists email_recipients_site_day_idx on public.email_campaign_recipients (website_id, created_at);
create index if not exists email_recipients_site_sent_idx on public.email_campaign_recipients (website_id, sent_at) where sent_at is not null;

create table if not exists public.email_test_sends (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  website_id text not null,
  campaign_id uuid references public.email_campaigns (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);
create index if not exists email_test_sends_org_idx on public.email_test_sends (organization_id, created_at);

create table if not exists public.email_events (
  id bigint generated always as identity primary key,
  provider_event_id text not null unique check (char_length(provider_event_id) between 1 and 100),
  type text not null check (type in ('delivered', 'bounced', 'complained', 'delivery_delayed')),
  recipient_id bigint not null references public.email_campaign_recipients (id) on delete cascade,
  organization_id uuid not null,
  website_id text not null,
  detail text check (detail is null or char_length(detail) <= 40),
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create table if not exists private.email_site_state (
  website_id text primary key references public.websites (id) on delete cascade,
  daily_cap integer not null default 10000 check (daily_cap between 0 and 1000000),
  paused_at timestamptz,
  paused_reason text check (paused_reason is null or paused_reason in ('bounces', 'complaints', 'staff')),
  paused_detail jsonb,
  resumed_at timestamptz,
  resumed_by uuid references auth.users (id) on delete set null
);

create table if not exists private.email_worker_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_hint text not null check (key_hint ~ '^[0-9a-f]{4}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null
);
create unique index if not exists email_worker_keys_one_active
  on private.email_worker_keys ((true)) where revoked_at is null;

create table if not exists private.email_webhook_status (
  id boolean primary key default true check (id),
  last_event_at timestamptz
);

-- RPC access only: no table grants to the API roles.
alter table public.email_sender_profiles enable row level security;
alter table public.email_contacts enable row level security;
alter table public.email_contact_imports enable row level security;
alter table public.email_campaigns enable row level security;
alter table public.email_campaign_recipients enable row level security;
alter table public.email_test_sends enable row level security;
alter table public.email_events enable row level security;
alter table private.email_site_state enable row level security;
alter table private.email_worker_keys enable row level security;
alter table private.email_webhook_status enable row level security;
revoke all on table public.email_sender_profiles, public.email_contacts, public.email_contact_imports,
  public.email_campaigns, public.email_campaign_recipients, public.email_test_sends, public.email_events
  from public, anon, authenticated;
revoke all on table private.email_site_state, private.email_worker_keys, private.email_webhook_status
  from public, anon, authenticated;

-- @part 3: helpers ----------------------------------------------------------------

-- 256-bit random key for unsubscribe tokens, generated inside the database and
-- kept in Vault (never printed, never in a dump without the project root key).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'email_unsubscribe_key_v1') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'email_unsubscribe_key_v1',
      'E-mail campaign unsubscribe tokens (HMAC-SHA256). Never print it.'
    );
  end if;
end;
$$;

-- The unsubscribe token of a contact: base64url(HMAC-SHA256(key, "<id>:<version>")), 43 characters.
create or replace function private.email_token(p_contact uuid, p_version integer)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'email_unsubscribe_key_v1';
  if v_key is null then
    raise exception 'email key missing' using errcode = 'XX000';
  end if;
  return translate(rtrim(encode(extensions.hmac(p_contact::text || ':' || p_version::text, v_key, 'sha256'),
    'base64'), '='), '+/', '-_');
end;
$$;

create or replace function private.email_contact_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.token_version is distinct from old.token_version then
    new.unsubscribe_token_hash := private.sha256_hex(private.email_token(new.id, new.token_version));
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists email_contacts_before_write on public.email_contacts;
create trigger email_contacts_before_write
  before insert or update on public.email_contacts
  for each row execute function private.email_contact_before_write();

-- Organization of a website the caller may act on with at least p_min_role.
create or replace function private.email_site_org(p_website text, p_min_role text)
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
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select organization_id into v_org from public.websites where id = p_website and status <> 'archived';
  if v_org is null or not private.has_org_role(v_org, p_min_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_org;
end;
$$;

-- A campaign the caller may act on with at least p_min_role (row locked FOR UPDATE).
create or replace function private.email_campaign_for(p_campaign uuid, p_min_role text)
returns public.email_campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.email_campaigns;
begin
  if (select auth.uid()) is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v from public.email_campaigns where id = p_campaign for update;
  if not found or not private.has_org_role(v.organization_id, p_min_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v;
end;
$$;

create or replace function private.email_assert_worker_key(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_key is null or p_key !~ '^lu_mail_[0-9a-f]{48}$' then
    raise exception 'invalid_key' using errcode = 'PT401';
  end if;
  select k.id into v_id from private.email_worker_keys k
  where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex') and k.revoked_at is null;
  if v_id is null then
    raise exception 'invalid_key' using errcode = 'PT401';
  end if;
  update private.email_worker_keys set last_used_at = now()
  where id = v_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
end;
$$;

create or replace function private.email_month_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;

-- E-mails counted against the plan this UTC month: campaign e-mails queued,
-- being sent or sent (failed and skipped ones do not count) and test sends.
create or replace function private.email_month_usage(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (select count(*) from public.email_campaign_recipients r
     where r.organization_id = p_org and r.created_at >= private.email_month_start()
       and r.status in ('queued', 'sending', 'sent'))
    + (select count(*) from public.email_test_sends t
       where t.organization_id = p_org and t.created_at >= private.email_month_start())
  )::integer;
$$;

-- Same count for one website since the start of the UTC day (daily cap).
create or replace function private.email_day_usage(p_website text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (select count(*) from public.email_campaign_recipients r
     where r.website_id = p_website and r.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
       and r.status in ('queued', 'sending', 'sent'))
    + (select count(*) from public.email_test_sends t
       where t.website_id = p_website and t.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc')
  )::integer;
$$;

create or replace function private.email_daily_cap(p_website text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.daily_cap from private.email_site_state s where s.website_id = p_website), 10000);
$$;

create or replace function private.email_paused(p_website text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.email_site_state s where s.website_id = p_website and s.paused_at is not null);
$$;

-- Quota, daily cap and pause switch before queueing p_count e-mails.
create or replace function private.email_assert_can_queue(p_org uuid, p_website text, p_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.email_paused(p_website) then
    raise exception 'sending_paused' using errcode = 'PT409';
  end if;
  perform private.assert_within_limit(p_org, 'emails_month', private.email_month_usage(p_org), p_count);
  if private.email_day_usage(p_website) + p_count > private.email_daily_cap(p_website) then
    raise exception 'daily_cap_reached' using errcode = 'PT429',
      detail = jsonb_build_object('cap', private.email_daily_cap(p_website))::text;
  end if;
end;
$$;

-- What the e-mails show: business name, logo, colour, reply-to, postal address.
-- The dashboard server turns a relative logo path into https://<domain>/<path>
-- and leaves out logos e-mail clients cannot show (SVG).
create or replace function private.email_brand(p_website text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'business_name', left(coalesce(sp.from_name, nullif(btrim(b.value ->> 'email_from_name'), ''),
      nullif(btrim(b.value ->> 'name'), ''), w.name), 60),
    'site_name', coalesce(nullif(btrim(b.value ->> 'name'), ''), w.name),
    'site_domain', w.primary_domain,
    'logo_url', coalesce(nullif(btrim(b.value ->> 'logo_url'), ''), o.logo_url),
    'brand_color', coalesce(sp.brand_color,
      case when lower(b.value ->> 'primary_color') ~ '^#[0-9a-f]{6}$' then lower(b.value ->> 'primary_color') end),
    'reply_to', coalesce(sp.reply_to,
      case when private.is_valid_email(lower(c.value ->> 'email')) then lower(c.value ->> 'email') end,
      case when private.is_valid_email(lower(c.value -> 'emails' ->> 0)) then lower(c.value -> 'emails' ->> 0) end),
    'postal_address', sp.postal_address)
  from public.websites w
  join public.organizations o on o.id = w.organization_id
  left join public.email_sender_profiles sp on sp.website_id = w.id
  left join public.website_settings b on b.website_id = w.id and b.key = 'branding' and jsonb_typeof(b.value) = 'object'
  left join public.website_settings c on c.website_id = w.id and c.key = 'contact' and jsonb_typeof(c.value) = 'object'
  where w.id = p_website;
$$;

-- What is missing before the first e-mail can go out (CAN-SPAM: a postal address).
create or replace function private.email_sender_missing(p_brand jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_remove(array[
    case when coalesce(btrim(p_brand ->> 'postal_address'), '') = '' then 'postal_address' end,
    case when not coalesce(private.is_valid_email(p_brand ->> 'reply_to'), false) then 'reply_to' end
  ], null);
$$;

create or replace function private.email_assert_content(p public.email_campaigns)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if btrim(p.subject) = '' then
    raise exception 'subject_required' using errcode = '22023';
  end if;
  if btrim(p.heading) = '' and btrim(p.body) = '' then
    raise exception 'content_required' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.email_campaign_stats(p_campaign uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'recipients', count(*),
    'pending', count(*) filter (where r.status in ('queued', 'sending')),
    'sent', count(*) filter (where r.status = 'sent'),
    'failed', count(*) filter (where r.status = 'failed'),
    'skipped', count(*) filter (where r.status = 'skipped'),
    'delivered', count(r.delivered_at),
    'bounced', count(r.bounced_at),
    'complained', count(r.complained_at),
    'unsubscribed', count(r.unsubscribed_at))
  from public.email_campaign_recipients r
  where r.campaign_id = p_campaign;
$$;

create or replace function private.email_campaign_json(c public.email_campaigns)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'website_id', c.website_id, 'template', c.template, 'locale', c.locale,
    'subject', c.subject, 'preview_text', c.preview_text, 'heading', c.heading, 'body', c.body,
    'button_label', c.button_label, 'button_url', c.button_url,
    'image_media_id', c.image_media_id, 'image_path', c.image_path,
    'status', c.status, 'scheduled_at', c.scheduled_at, 'started_at', c.started_at,
    'finished_at', c.finished_at, 'failure_reason', c.failure_reason,
    'recipient_count', c.recipient_count, 'created_at', c.created_at, 'updated_at', c.updated_at,
    'stats', private.email_campaign_stats(c.id));
$$;

-- @part 4: audience ----------------------------------------------------------------

-- Newsletter sign-up (explicit consent on the website's form). A contact who
-- unsubscribed and signs up again is subscribed again with a new token; bounced
-- and complained addresses stay out.
create or replace function private.email_contact_from_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(new.email));
begin
  if new.form_type = 'newsletter' and private.is_valid_email(v_email) then
    insert into public.email_contacts as c (organization_id, website_id, email, name, source, consent_at, consent_source)
    values (new.organization_id, new.website_id, v_email, left(new.name, 120), 'newsletter', new.created_at,
            'form:newsletter:' || new.id::text)
    on conflict (website_id, email) do update
      set status = 'subscribed', source = 'newsletter', consent_at = excluded.consent_at,
          consent_source = excluded.consent_source, token_version = c.token_version + 1,
          name = coalesce(c.name, excluded.name)
      where c.status = 'unsubscribed';
  end if;
  return new;
end;
$$;

drop trigger if exists form_submissions_email_contact on public.form_submissions;
create trigger form_submissions_email_contact
  after insert on public.form_submissions
  for each row execute function private.email_contact_from_submission();

-- Backfill: newsletter sign-ups already received (oldest consent kept).
insert into public.email_contacts (organization_id, website_id, email, name, source, consent_at, consent_source)
select distinct on (s.website_id, lower(btrim(s.email)))
  s.organization_id, s.website_id, lower(btrim(s.email)), left(s.name, 120), 'newsletter', s.created_at,
  'form:newsletter:' || s.id::text
from public.form_submissions s
where s.form_type = 'newsletter' and private.is_valid_email(lower(btrim(s.email)))
order by s.website_id, lower(btrim(s.email)), s.created_at
on conflict (website_id, email) do nothing;

-- @part 5: member reads ----------------------------------------------------------

create or replace function public.email_overview(p_website_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.email_site_org(p_website_id, 'viewer');
  v_brand jsonb := private.email_brand(p_website_id);
  v_state private.email_site_state;
  v_sender public.email_sender_profiles;
  v_last timestamptz;
begin
  select * into v_state from private.email_site_state where website_id = p_website_id;
  select * into v_sender from public.email_sender_profiles where website_id = p_website_id;
  select last_event_at into v_last from private.email_webhook_status;
  return jsonb_build_object(
    'can_edit', private.has_org_role(v_org, 'editor'),
    'can_send', private.has_org_role(v_org, 'admin'),
    'brand', v_brand,
    'sender', case when v_sender.website_id is null then null else jsonb_build_object(
      'from_name', v_sender.from_name, 'reply_to', v_sender.reply_to,
      'postal_address', v_sender.postal_address, 'brand_color', v_sender.brand_color,
      'updated_at', v_sender.updated_at) end,
    'missing', to_jsonb(private.email_sender_missing(v_brand)),
    'contacts', (select jsonb_build_object(
        'total', count(*),
        'subscribed', count(*) filter (where c.status = 'subscribed'),
        'unsubscribed', count(*) filter (where c.status = 'unsubscribed'),
        'bounced', count(*) filter (where c.status = 'bounced'),
        'complained', count(*) filter (where c.status = 'complained'))
      from public.email_contacts c where c.website_id = p_website_id),
    'quota', jsonb_build_object('limit', private.plan_limit(v_org, 'emails_month'),
      'used', private.email_month_usage(v_org), 'plan', private.org_plan_key(v_org)),
    'daily', jsonb_build_object('cap', private.email_daily_cap(p_website_id),
      'used', private.email_day_usage(p_website_id)),
    'paused', case when v_state.paused_at is null then null
      else jsonb_build_object('at', v_state.paused_at, 'reason', v_state.paused_reason) end,
    'delivery_tracking', coalesce(v_last > now() - interval '30 days', false));
end;
$$;

-- Contacts: emails and names masked for viewers (like payments and the inbox).
create or replace function public.email_contacts_list(
  p_website_id text,
  p_search text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.email_site_org(p_website_id, 'viewer');
  v_pii boolean := private.has_org_role(v_org, 'editor');
  v_search text := nullif(btrim(left(coalesce(p_search, ''), 100)), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 1000000);
  v_pattern text;
begin
  if p_status is not null and p_status not in ('subscribed', 'unsubscribed', 'bounced', 'complained') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  -- Viewers cannot search by address (the search would reveal masked e-mails).
  if not v_pii then
    v_search := null;
  end if;
  v_pattern := '%' || replace(replace(replace(lower(coalesce(v_search, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return jsonb_build_object(
    'pii', v_pii,
    'total', (select count(*) from public.email_contacts c
      where c.website_id = p_website_id and (p_status is null or c.status = p_status)
        and (v_search is null or c.email like v_pattern or lower(coalesce(c.name, '')) like v_pattern)),
    'rows', coalesce((select jsonb_agg(x.j order by x.created_at desc, x.id) from (
      select c.created_at, c.id, jsonb_build_object(
        'id', c.id,
        'email', case when v_pii then c.email else private.mask_email(c.email) end,
        'name', case when v_pii then c.name else private.mask_name(c.name) end,
        'source', c.source, 'status', c.status, 'consent_at', c.consent_at,
        'consent_source', case when v_pii then c.consent_source else null end,
        'status_changed_at', c.status_changed_at, 'created_at', c.created_at) as j
      from public.email_contacts c
      where c.website_id = p_website_id and (p_status is null or c.status = p_status)
        and (v_search is null or c.email like v_pattern or lower(coalesce(c.name, '')) like v_pattern)
      order by c.created_at desc, c.id
      limit v_limit offset v_offset) x), '[]'::jsonb));
end;
$$;

create or replace function public.email_campaigns_list(p_website_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.email_site_org(p_website_id, 'viewer');
begin
  return coalesce((
    select jsonb_agg(private.email_campaign_json(c) order by coalesce(c.finished_at, c.started_at, c.scheduled_at, c.updated_at) desc)
    from public.email_campaigns c
    where c.id in (select x.id from public.email_campaigns x where x.website_id = p_website_id
                   order by x.updated_at desc limit 200)), '[]'::jsonb);
end;
$$;

create or replace function public.email_campaign_get(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.email_campaigns;
begin
  select * into v from public.email_campaigns where id = p_campaign_id;
  if not found or (select auth.uid()) is null or not private.has_org_role(v.organization_id, 'viewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.email_campaign_json(v);
end;
$$;

-- @part 6: member writes ---------------------------------------------------------

create or replace function public.email_save_sender(
  p_website_id text,
  p_from_name text,
  p_reply_to text,
  p_postal_address text,
  p_brand_color text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.email_site_org(p_website_id, 'admin');
  v_from text := private.check_text(p_from_name, 60, 'from_name');
  v_reply text := lower(private.check_text(p_reply_to, 254, 'reply_to'));
  v_address text := private.check_text(p_postal_address, 300, 'postal_address', true);
  v_color text := lower(nullif(btrim(coalesce(p_brand_color, '')), ''));
begin
  perform private.assert_mfa();
  perform private.assert_org_unlocked(v_org);
  if v_reply is not null and not private.is_valid_email(v_reply) then
    raise exception 'invalid_reply_to' using errcode = '22023';
  end if;
  if v_address is null or char_length(v_address) < 10 then
    raise exception 'postal_address_required' using errcode = '22023';
  end if;
  if v_color is not null and v_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid_color' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('email_sender', p_website_id, 30, interval '1 hour');
  insert into public.email_sender_profiles as s (website_id, organization_id, from_name, reply_to,
    postal_address, brand_color, updated_by, updated_at)
  values (p_website_id, v_org, v_from, v_reply, v_address, v_color, (select auth.uid()), now())
  on conflict (website_id) do update set from_name = excluded.from_name, reply_to = excluded.reply_to,
    postal_address = excluded.postal_address, brand_color = excluded.brand_color,
    updated_by = excluded.updated_by, updated_at = now();
  perform private.site_audit(p_website_id, v_org, 'email.sender_updated', null,
    jsonb_build_object('from_name', v_from, 'reply_to_set', v_reply is not null, 'brand_color', v_color));
  return private.email_brand(p_website_id);
end;
$$;

-- Owners and admins import a list, only after confirming every contact gave
-- consent (recorded with the statement shown). Existing contacts are never
-- changed: an unsubscribed, bounced or complained address stays out.
create or replace function public.email_contacts_import(
  p_website_id text,
  p_contacts jsonb,
  p_consent_confirmed boolean,
  p_consent_statement text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.email_site_org(p_website_id, 'admin');
  v_statement text := private.check_text(p_consent_statement, 500, 'consent_statement', true);
  v_import uuid;
  v_received integer;
  v_valid integer;
  v_added integer;
  r jsonb;
  v_email text;
  v_name text;
  v_clean jsonb := '[]'::jsonb;
begin
  perform private.assert_mfa();
  perform private.assert_org_unlocked(v_org);
  if p_consent_confirmed is distinct from true or v_statement is null or char_length(v_statement) < 10 then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if p_contacts is null or jsonb_typeof(p_contacts) <> 'array' then
    raise exception 'invalid_contacts' using errcode = '22023';
  end if;
  v_received := jsonb_array_length(p_contacts);
  if v_received = 0 or v_received > 5000 or pg_column_size(p_contacts) > 1500000 then
    raise exception 'invalid_contacts' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('email_import', p_website_id, 20, interval '1 hour');

  for r in select value from jsonb_array_elements(p_contacts) loop
    if jsonb_typeof(r) <> 'object' then
      continue;
    end if;
    v_email := lower(btrim(left(coalesce(r ->> 'email', ''), 300)));
    if not private.is_valid_email(v_email) then
      continue;
    end if;
    begin
      v_name := private.check_text(r ->> 'name', 120, 'name');
    exception when others then
      v_name := null;
    end;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('email', v_email, 'name', v_name));
  end loop;
  select count(distinct x ->> 'email') into v_valid from jsonb_array_elements(v_clean) x;

  insert into public.email_contact_imports (organization_id, website_id, imported_by, consent_confirmed,
    consent_statement, rows_received)
  values (v_org, p_website_id, (select auth.uid()), true, v_statement, v_received)
  returning id into v_import;

  insert into public.email_contacts (organization_id, website_id, email, name, source, consent_at, consent_source)
  select distinct on (x ->> 'email') v_org, p_website_id, x ->> 'email', x ->> 'name', 'import', now(),
    'import:' || v_import::text
  from jsonb_array_elements(v_clean) x
  on conflict (website_id, email) do nothing;
  get diagnostics v_added = row_count;

  update public.email_contact_imports set rows_added = v_added, rows_existing = v_valid - v_added,
    rows_invalid = v_received - jsonb_array_length(v_clean)
  where id = v_import;
  perform private.site_audit(p_website_id, v_org, 'email.contacts_imported', v_import::text,
    jsonb_build_object('received', v_received, 'added', v_added, 'existing', v_valid - v_added,
      'invalid', v_received - jsonb_array_length(v_clean), 'consent_confirmed', true));
  return jsonb_build_object('import_id', v_import, 'received', v_received, 'added', v_added,
    'existing', v_valid - v_added, 'invalid', v_received - jsonb_array_length(v_clean));
end;
$$;

-- Owners and admins: every contact with its address (audited).
create or replace function public.email_contacts_export(p_website_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.email_site_org(p_website_id, 'admin');
  v_rows jsonb;
begin
  perform private.assert_mfa();
  perform private.hit_rate_limit('email_export', (select auth.uid())::text, 20, interval '1 hour');
  select coalesce(jsonb_agg(jsonb_build_object('email', c.email, 'name', c.name, 'status', c.status,
      'source', c.source, 'consent_at', c.consent_at, 'consent_source', c.consent_source,
      'status_changed_at', c.status_changed_at, 'created_at', c.created_at) order by c.created_at), '[]'::jsonb)
  into v_rows
  from public.email_contacts c where c.website_id = p_website_id;
  perform private.site_audit(p_website_id, v_org, 'email.contacts_exported', null,
    jsonb_build_object('rows', jsonb_array_length(v_rows)));
  return v_rows;
end;
$$;

-- Owners and admins unsubscribe a contact who asked them directly (never the
-- other way: subscribing again needs the person's own consent).
create or replace function public.email_contact_unsubscribe(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.email_contacts;
begin
  select * into v from public.email_contacts where id = p_contact_id for update;
  if not found or (select auth.uid()) is null or not private.has_org_role(v.organization_id, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v.status <> 'subscribed' then
    return;
  end if;
  update public.email_contacts set status = 'unsubscribed' where id = p_contact_id;
  perform private.site_audit(v.website_id, v.organization_id, 'email.contact_unsubscribed', p_contact_id::text,
    jsonb_build_object('by', 'member'));
end;
$$;

-- Editors create and edit drafts. Strict keys; every text checked (length, no HTML).
create or replace function public.email_campaign_save(
  p_website_id text,
  p_campaign_id uuid,
  p_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.email_site_org(p_website_id, 'editor');
  v public.email_campaigns;
  v_template text := coalesce(p_values ->> 'template', 'newsletter');
  v_locale text := coalesce(p_values ->> 'locale', 'en');
  v_subject text;
  v_preview text;
  v_heading text;
  v_body text;
  v_label text;
  v_url text;
  v_media uuid;
  v_path text;
  k text;
begin
  perform private.assert_org_unlocked(v_org);
  if p_values is null or jsonb_typeof(p_values) <> 'object' or pg_column_size(p_values) > 60000 then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_values) loop
    if k not in ('template', 'locale', 'subject', 'preview_text', 'heading', 'body', 'button_label',
                 'button_url', 'image_media_id') then
      raise exception 'invalid_values' using errcode = '22023';
    end if;
  end loop;
  if v_template not in ('newsletter', 'announcement', 'promotion', 'event', 'letter', 'thank_you')
     or v_locale not in ('en', 'fr') then
    raise exception 'invalid_values' using errcode = '22023';
  end if;
  v_subject := coalesce(private.check_text(p_values ->> 'subject', 120, 'subject'), '');
  v_preview := coalesce(private.check_text(p_values ->> 'preview_text', 150, 'preview_text'), '');
  v_heading := coalesce(private.check_text(p_values ->> 'heading', 150, 'heading'), '');
  v_body := coalesce(private.check_text(p_values ->> 'body', 10000, 'body', true), '');
  v_label := private.check_text(p_values ->> 'button_label', 40, 'button_label');
  v_url := private.check_url(p_values ->> 'button_url', 2048, 'button_url');
  if (v_label is null) <> (v_url is null) then
    raise exception 'button_incomplete' using errcode = '22023';
  end if;
  if nullif(p_values ->> 'image_media_id', '') is not null then
    v_media := private.safe_uuid(p_values ->> 'image_media_id');
    select m.storage_path into v_path from public.media m
    where m.id = v_media and m.website_id = p_website_id and m.mime_type like 'image/%'
      and m.mime_type <> 'image/svg+xml';
    if v_path is null then
      raise exception 'invalid_image' using errcode = '22023';
    end if;
  end if;

  if p_campaign_id is null then
    perform private.hit_rate_limit('email_campaign_create', p_website_id, 60, interval '1 hour');
    insert into public.email_campaigns (organization_id, website_id, template, locale, subject, preview_text,
      heading, body, button_label, button_url, image_media_id, image_path, created_by, updated_by)
    values (v_org, p_website_id, v_template, v_locale, v_subject, v_preview, v_heading, v_body, v_label, v_url,
      v_media, v_path, (select auth.uid()), (select auth.uid()))
    returning * into v;
    perform private.site_audit(p_website_id, v_org, 'email.campaign_created', v.id::text,
      jsonb_build_object('template', v_template));
  else
    select * into v from public.email_campaigns where id = p_campaign_id and website_id = p_website_id for update;
    if not found then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if v.status <> 'draft' then
      raise exception 'not_draft' using errcode = 'PT409';
    end if;
    update public.email_campaigns set template = v_template, locale = v_locale, subject = v_subject,
      preview_text = v_preview, heading = v_heading, body = v_body, button_label = v_label, button_url = v_url,
      image_media_id = v_media, image_path = v_path, updated_by = (select auth.uid()), updated_at = now()
    where id = p_campaign_id
    returning * into v;
    perform private.site_audit(p_website_id, v_org, 'email.campaign_updated', v.id::text,
      jsonb_build_object('template', v_template));
  end if;
  return private.email_campaign_json(v);
end;
$$;

-- Test e-mail to the caller's own address (editors and up). Counts against the
-- quota and the daily cap; 10 per hour per person.
create or replace function public.email_campaign_test(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.email_campaigns := private.email_campaign_for(p_campaign_id, 'editor');
  v_brand jsonb := private.email_brand(v.website_id);
  v_to text;
begin
  perform private.assert_org_unlocked(v.organization_id);
  perform private.email_assert_content(v);
  if cardinality(private.email_sender_missing(v_brand)) > 0 then
    raise exception 'sender_details_required' using errcode = 'PT412';
  end if;
  select lower(u.email) into v_to from auth.users u where u.id = (select auth.uid());
  if not private.is_valid_email(v_to) then
    raise exception 'no_email' using errcode = '22023';
  end if;
  perform private.email_assert_can_queue(v.organization_id, v.website_id, 1);
  perform private.hit_rate_limit('email_test', (select auth.uid())::text, 10, interval '1 hour');
  insert into public.email_test_sends (organization_id, website_id, campaign_id, user_id)
  values (v.organization_id, v.website_id, v.id, (select auth.uid()));
  perform private.site_audit(v.website_id, v.organization_id, 'email.test_sent', v.id::text, '{}'::jsonb);
  return jsonb_build_object('to', v_to, 'campaign', private.email_campaign_json(v), 'sender', v_brand);
end;
$$;

-- Snapshot of the audience and the sender, then status `sending`. Shared by
-- "send now" and the worker (due scheduled campaigns). Raises on any refusal.
create or replace function private.email_start_campaign(p_campaign uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.email_campaigns;
  v_brand jsonb;
  v_count integer;
begin
  select * into v from public.email_campaigns where id = p_campaign for update;
  if not found or v.status not in ('draft', 'scheduled') then
    raise exception 'not_draft' using errcode = 'PT409';
  end if;
  perform private.email_assert_content(v);
  v_brand := private.email_brand(v.website_id);
  if cardinality(private.email_sender_missing(v_brand)) > 0 then
    raise exception 'sender_details_required' using errcode = 'PT412';
  end if;
  select count(*) into v_count from public.email_contacts c
  where c.website_id = v.website_id and c.status = 'subscribed';
  if v_count = 0 then
    raise exception 'no_recipients' using errcode = 'PT409';
  end if;
  perform private.email_assert_can_queue(v.organization_id, v.website_id, v_count);

  insert into public.email_campaign_recipients (campaign_id, organization_id, website_id, contact_id, batch_no)
  select v.id, v.organization_id, v.website_id, c.id,
    ((row_number() over (order by c.created_at, c.id)) - 1)::integer / 50
  from public.email_contacts c
  where c.website_id = v.website_id and c.status = 'subscribed';
  get diagnostics v_count = row_count;

  update public.email_campaigns set status = 'sending', started_at = now(), recipient_count = v_count,
    sender = v_brand, failure_reason = null, updated_at = now()
  where id = v.id;
  return v_count;
end;
$$;

create or replace function public.email_campaign_send(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.email_campaigns := private.email_campaign_for(p_campaign_id, 'admin');
  v_count integer;
begin
  perform private.assert_mfa();
  perform private.assert_org_unlocked(v.organization_id);
  if v.status <> 'draft' then
    raise exception 'not_draft' using errcode = 'PT409';
  end if;
  perform private.hit_rate_limit('email_send', v.website_id, 10, interval '1 hour');
  v_count := private.email_start_campaign(v.id);
  perform private.site_audit(v.website_id, v.organization_id, 'email.campaign_started', v.id::text,
    jsonb_build_object('recipients', v_count, 'subject', v.subject));
  return jsonb_build_object('recipients', v_count);
end;
$$;

create or replace function public.email_campaign_schedule(p_campaign_id uuid, p_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.email_campaigns := private.email_campaign_for(p_campaign_id, 'admin');
  v_count integer;
begin
  perform private.assert_mfa();
  perform private.assert_org_unlocked(v.organization_id);
  if v.status <> 'draft' then
    raise exception 'not_draft' using errcode = 'PT409';
  end if;
  if p_at is null or p_at < now() + interval '5 minutes' or p_at > now() + interval '90 days' then
    raise exception 'invalid_schedule' using errcode = '22023';
  end if;
  perform private.email_assert_content(v);
  if cardinality(private.email_sender_missing(private.email_brand(v.website_id))) > 0 then
    raise exception 'sender_details_required' using errcode = 'PT412';
  end if;
  select count(*) into v_count from public.email_contacts c
  where c.website_id = v.website_id and c.status = 'subscribed';
  if v_count = 0 then
    raise exception 'no_recipients' using errcode = 'PT409';
  end if;
  -- Checked again when it starts (the list and the month may have changed by then).
  perform private.email_assert_can_queue(v.organization_id, v.website_id, v_count);
  update public.email_campaigns set status = 'scheduled', scheduled_at = p_at, failure_reason = null,
    updated_by = (select auth.uid()), updated_at = now()
  where id = v.id;
  perform private.site_audit(v.website_id, v.organization_id, 'email.campaign_scheduled', v.id::text,
    jsonb_build_object('at', p_at, 'subject', v.subject));
  return jsonb_build_object('scheduled_at', p_at, 'recipients', v_count);
end;
$$;

-- Back to draft: a scheduled campaign, or one that failed before any e-mail was queued.
create or replace function public.email_campaign_to_draft(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.email_campaigns := private.email_campaign_for(p_campaign_id, 'admin');
begin
  if not (v.status = 'scheduled' or (v.status = 'failed' and v.recipient_count = 0)) then
    raise exception 'not_scheduled' using errcode = 'PT409';
  end if;
  update public.email_campaigns set status = 'draft', scheduled_at = null, failure_reason = null,
    updated_by = (select auth.uid()), updated_at = now()
  where id = v.id;
  perform private.site_audit(v.website_id, v.organization_id, 'email.campaign_unscheduled', v.id::text, '{}'::jsonb);
end;
$$;

-- @part 7: sending (claim / record) ----------------------------------------------

-- Next batch of a sending campaign: leased for 3 minutes, contacts re-checked
-- (not subscribed any more -> skipped), each with its unsubscribe token.
-- {status: 'idle' | 'paused' | 'done' | 'batch', ...}
create or replace function private.email_claim(p_campaign uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.email_campaigns;
  v_batch integer;
  v_rows jsonb;
  v_try integer := 0;
begin
  select * into v from public.email_campaigns where id = p_campaign;
  if not found or v.status <> 'sending' then
    return jsonb_build_object('status', 'done');
  end if;
  if private.email_paused(v.website_id) then
    return jsonb_build_object('status', 'paused');
  end if;

  loop
    v_try := v_try + 1;
    exit when v_try > 3;
    select r.batch_no into v_batch from public.email_campaign_recipients r
    where r.campaign_id = p_campaign
      and (r.status = 'queued' or (r.status = 'sending' and r.lease_until < now()))
    order by r.batch_no
    limit 1
    for update skip locked;
    if v_batch is null then
      -- Nothing claimable: either another sender holds the last batches, or all done.
      if exists (select 1 from public.email_campaign_recipients r
                 where r.campaign_id = p_campaign and r.status in ('queued', 'sending')) then
        return jsonb_build_object('status', 'idle');
      end if;
      perform private.email_finalize(p_campaign);
      return jsonb_build_object('status', 'done');
    end if;

    -- Too many attempts: give up on these rows.
    update public.email_campaign_recipients r set status = 'failed', error = 'max_attempts', lease_until = null
    where r.campaign_id = p_campaign and r.batch_no = v_batch and r.attempts >= 5
      and (r.status = 'queued' or (r.status = 'sending' and r.lease_until < now()));

    -- Anyone who is no longer subscribed is never sent to.
    update public.email_campaign_recipients r set status = 'skipped', lease_until = null
    from public.email_contacts c
    where r.campaign_id = p_campaign and r.batch_no = v_batch and c.id = r.contact_id
      and c.status <> 'subscribed'
      and (r.status = 'queued' or (r.status = 'sending' and r.lease_until < now()));

    with claimed as (
      update public.email_campaign_recipients r
      set status = 'sending', lease_until = now() + interval '3 minutes', attempts = r.attempts + 1
      where r.campaign_id = p_campaign and r.batch_no = v_batch
        and (r.status = 'queued' or (r.status = 'sending' and r.lease_until < now()))
      returning r.id, r.contact_id, r.attempts
    )
    select jsonb_agg(jsonb_build_object('id', cl.id, 'email', c.email, 'name', c.name,
        'token', private.email_token(c.id, c.token_version)) order by cl.id)
    into v_rows
    from claimed cl join public.email_contacts c on c.id = cl.contact_id;

    if v_rows is not null then
      return jsonb_build_object('status', 'batch', 'batch_no', v_batch,
        'campaign', jsonb_build_object('id', v.id, 'website_id', v.website_id, 'template', v.template,
          'locale', v.locale, 'subject', v.subject, 'preview_text', v.preview_text, 'heading', v.heading,
          'body', v.body, 'button_label', v.button_label, 'button_url', v.button_url,
          'image_path', v.image_path),
        'sender', v.sender,
        'recipients', v_rows);
    end if;
    v_batch := null;
  end loop;
  return jsonb_build_object('status', 'idle');
end;
$$;

create or replace function private.email_finalize(p_campaign uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.email_campaigns;
  v_stats jsonb;
begin
  select * into v from public.email_campaigns where id = p_campaign for update;
  if not found or v.status <> 'sending' then
    return;
  end if;
  if exists (select 1 from public.email_campaign_recipients r
             where r.campaign_id = p_campaign and r.status in ('queued', 'sending')) then
    return;
  end if;
  v_stats := private.email_campaign_stats(p_campaign);
  update public.email_campaigns
  set status = case when (v_stats ->> 'sent')::integer > 0 or (v_stats ->> 'failed')::integer = 0 then 'sent' else 'failed' end,
      failure_reason = case when (v_stats ->> 'sent')::integer = 0 and (v_stats ->> 'failed')::integer > 0 then 'provider' end,
      finished_at = now(), updated_at = now()
  where id = p_campaign;
  perform private.site_audit(v.website_id, v.organization_id, 'email.campaign_finished', v.id::text,
    jsonb_build_object('sent', v_stats -> 'sent', 'failed', v_stats -> 'failed', 'skipped', v_stats -> 'skipped'));
end;
$$;

-- Result of one batch: {outcome: 'sent' | 'retry' | 'failed' | 'already_sent',
--   messages: [{id, message_id}], error}. Only rows of that batch still `sending`.
create or replace function private.email_record(p_campaign uuid, p_batch integer, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome text := p_result ->> 'outcome';
  v_error text := left(regexp_replace(coalesce(p_result ->> 'error', ''), '[^a-z0-9_]', '', 'g'), 80);
  m jsonb;
  n integer := 0;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object'
     or v_outcome not in ('sent', 'retry', 'failed', 'already_sent') or p_batch is null then
    raise exception 'invalid_result' using errcode = '22023';
  end if;
  if v_outcome = 'sent' then
    if jsonb_typeof(p_result -> 'messages') <> 'array' then
      raise exception 'invalid_result' using errcode = '22023';
    end if;
    for m in select value from jsonb_array_elements(p_result -> 'messages') loop
      if (m ->> 'message_id') !~ '^[A-Za-z0-9_-]{8,100}$' then
        raise exception 'invalid_result' using errcode = '22023';
      end if;
      update public.email_campaign_recipients set status = 'sent', sent_at = now(), lease_until = null,
        provider_message_id = m ->> 'message_id', error = null
      where id = (m ->> 'id')::bigint and campaign_id = p_campaign and batch_no = p_batch and status = 'sending';
      n := n + 1;
    end loop;
  elsif v_outcome = 'already_sent' then
    update public.email_campaign_recipients set status = 'sent', sent_at = now(), lease_until = null
    where campaign_id = p_campaign and batch_no = p_batch and status = 'sending';
  elsif v_outcome = 'retry' then
    update public.email_campaign_recipients set status = case when attempts >= 5 then 'failed' else 'queued' end,
      error = nullif(v_error, ''), lease_until = null
    where campaign_id = p_campaign and batch_no = p_batch and status = 'sending';
  else
    update public.email_campaign_recipients set status = 'failed', error = coalesce(nullif(v_error, ''), 'failed'),
      lease_until = null
    where campaign_id = p_campaign and batch_no = p_batch and status = 'sending';
  end if;
  perform private.email_finalize(p_campaign);
  return jsonb_build_object('ok', true, 'recorded', n);
end;
$$;

-- Signed-in owner / admin (the dashboard keeps sending while the page is open).
create or replace function public.email_campaign_claim(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.email_campaigns;
begin
  select * into v from public.email_campaigns where id = p_campaign_id;
  if not found or (select auth.uid()) is null or not private.has_org_role(v.organization_id, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_mfa();
  return private.email_claim(p_campaign_id);
end;
$$;

create or replace function public.email_campaign_record(p_campaign_id uuid, p_batch integer, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.email_campaigns;
begin
  select * into v from public.email_campaigns where id = p_campaign_id;
  if not found or (select auth.uid()) is null or not private.has_org_role(v.organization_id, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_mfa();
  return private.email_record(p_campaign_id, p_batch, p_result);
end;
$$;

-- Worker (cron route, anon + e-mail worker key): starts due scheduled campaigns
-- (a refusal marks the campaign failed with its reason) and lists campaigns
-- with e-mails left to send.
create or replace function public.email_worker_due(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_reason text;
  v_count integer;
begin
  perform private.email_assert_worker_key(p_key);
  for c in select id, website_id, organization_id from public.email_campaigns
           where status = 'scheduled' and scheduled_at <= now() order by scheduled_at limit 20 loop
    begin
      v_count := private.email_start_campaign(c.id);
      perform private.site_audit(c.website_id, c.organization_id, 'email.campaign_started', c.id::text,
        jsonb_build_object('recipients', v_count, 'scheduled', true));
    exception when others then
      v_reason := case sqlerrm
        when 'plan_limit_reached' then 'quota' when 'daily_cap_reached' then 'daily_cap'
        when 'sending_paused' then 'paused' when 'sender_details_required' then 'sender_missing'
        when 'no_recipients' then 'no_recipients' when 'subject_required' then 'content_missing'
        when 'content_required' then 'content_missing' else null end;
      if v_reason is null then
        -- Unexpected error: left scheduled, tried again on the next run.
        continue;
      end if;
      update public.email_campaigns set status = 'failed', failure_reason = v_reason, finished_at = now(),
        updated_at = now()
      where id = c.id and status = 'scheduled';
      perform private.site_audit(c.website_id, c.organization_id, 'email.campaign_failed', c.id::text,
        jsonb_build_object('reason', v_reason));
    end;
  end loop;
  return coalesce((
    select jsonb_agg(x.id order by x.started_at) from (
      select cp.id, cp.started_at from public.email_campaigns cp
      where cp.status = 'sending' and not private.email_paused(cp.website_id)
        and exists (select 1 from public.email_campaign_recipients r where r.campaign_id = cp.id
                    and (r.status = 'queued' or (r.status = 'sending' and r.lease_until < now())))
      order by cp.started_at limit 20) x), '[]'::jsonb);
end;
$$;

create or replace function public.email_worker_claim(p_key text, p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.email_assert_worker_key(p_key);
  return private.email_claim(p_campaign_id);
end;
$$;

create or replace function public.email_worker_record(p_key text, p_campaign_id uuid, p_batch integer, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.email_assert_worker_key(p_key);
  return private.email_record(p_campaign_id, p_batch, p_result);
end;
$$;

-- @part 8: delivery events, auto-pause ------------------------------------------

-- Bounce rate >= 5 % or complaint rate >= 0.3 % over 30 days (100 sent at least) pauses the website.
create or replace function private.email_check_health(p_website text, p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent integer;
  v_bounced integer;
  v_complained integer;
  v_reason text;
begin
  if private.email_paused(p_website) then
    return;
  end if;
  select count(*), count(r.bounced_at), count(r.complained_at) into v_sent, v_bounced, v_complained
  from public.email_campaign_recipients r
  where r.website_id = p_website and r.sent_at >= now() - interval '30 days';
  if v_sent < 100 then
    return;
  end if;
  if v_complained * 1000 >= v_sent * 3 then
    v_reason := 'complaints';
  elsif v_bounced * 100 >= v_sent * 5 then
    v_reason := 'bounces';
  else
    return;
  end if;
  insert into private.email_site_state as s (website_id, paused_at, paused_reason, paused_detail)
  values (p_website, now(), v_reason,
    jsonb_build_object('sent', v_sent, 'bounced', v_bounced, 'complained', v_complained))
  on conflict (website_id) do update set paused_at = now(), paused_reason = excluded.paused_reason,
    paused_detail = excluded.paused_detail;
  perform private.site_audit(p_website, p_org, 'email.sending_paused', null,
    jsonb_build_object('reason', v_reason, 'sent', v_sent, 'bounced', v_bounced, 'complained', v_complained));
end;
$$;

-- One provider event, already verified by the webhook route:
-- {id, type: delivered | bounced | complained | delivery_delayed, email_id, created_at, bounce_type}.
create or replace function public.email_ingest_event(p_key text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := p_event ->> 'id';
  v_type text := p_event ->> 'type';
  v_bounce text := left(p_event ->> 'bounce_type', 40);
  v_at timestamptz;
  r public.email_campaign_recipients;
  v_inserted bigint;
begin
  perform private.email_assert_worker_key(p_key);
  if p_event is null or jsonb_typeof(p_event) <> 'object' or v_id is null or v_id !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  insert into private.email_webhook_status (id, last_event_at) values (true, now())
  on conflict (id) do update set last_event_at = now();
  if v_type not in ('delivered', 'bounced', 'complained', 'delivery_delayed') then
    return jsonb_build_object('status', 'ignored');
  end if;
  if (p_event ->> 'email_id') is null or (p_event ->> 'email_id') !~ '^[A-Za-z0-9_-]{8,100}$' then
    return jsonb_build_object('status', 'ignored');
  end if;
  begin
    v_at := coalesce((p_event ->> 'created_at')::timestamptz, now());
  exception when others then
    v_at := now();
  end;
  select * into r from public.email_campaign_recipients where provider_message_id = p_event ->> 'email_id' for update;
  if not found then
    -- Not a campaign e-mail (account e-mails, tests): nothing to do.
    return jsonb_build_object('status', 'ignored');
  end if;
  insert into public.email_events (provider_event_id, type, recipient_id, organization_id, website_id, detail, occurred_at)
  values (v_id, v_type, r.id, r.organization_id, r.website_id, v_bounce, v_at)
  on conflict (provider_event_id) do nothing
  returning id into v_inserted;
  if v_inserted is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if v_type = 'delivered' then
    update public.email_campaign_recipients set delivered_at = coalesce(delivered_at, v_at) where id = r.id;
  elsif v_type = 'bounced' and coalesce(lower(v_bounce), '') <> 'transient' then
    update public.email_campaign_recipients set bounced_at = coalesce(bounced_at, v_at) where id = r.id;
    update public.email_contacts set status = 'bounced' where id = r.contact_id and status = 'subscribed';
  elsif v_type = 'complained' then
    update public.email_campaign_recipients set complained_at = coalesce(complained_at, v_at) where id = r.id;
    update public.email_contacts set status = 'complained' where id = r.contact_id and status <> 'complained';
  end if;
  if v_type in ('bounced', 'complained') then
    perform private.site_audit(r.website_id, r.organization_id, 'email.contact_' || v_type, r.contact_id::text,
      jsonb_build_object('campaign', r.campaign_id, 'detail', v_bounce));
    perform private.email_check_health(r.website_id, r.organization_id);
  end if;
  return jsonb_build_object('status', 'applied');
end;
$$;

-- @part 9: unsubscribe (public) ---------------------------------------------------

create or replace function private.email_contact_by_token(p_token text)
returns public.email_contacts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.email_contacts;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  select * into v from public.email_contacts where unsubscribe_token_hash = private.sha256_hex(p_token);
  return v;
end;
$$;

create or replace function public.email_unsubscribe_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.email_contacts := private.email_contact_by_token(p_token);
begin
  if v.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  return jsonb_build_object(
    'status', case when v.status = 'subscribed' then 'subscribed' else 'unsubscribed' end,
    'site_name', private.email_brand(v.website_id) ->> 'business_name',
    'email', private.mask_email(v.email));
end;
$$;

-- One click: the contact behind this token only. A second call changes nothing.
-- p_campaign_id (from the link) only credits the unsubscribe to that campaign's
-- statistics when this contact was one of its recipients.
create or replace function public.email_unsubscribe(p_token text, p_campaign_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.email_contacts := private.email_contact_by_token(p_token);
begin
  if v.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v.status <> 'subscribed' then
    return jsonb_build_object('status', 'already');
  end if;
  update public.email_contacts set status = 'unsubscribed' where id = v.id and status = 'subscribed';
  if p_campaign_id is not null then
    update public.email_campaign_recipients set unsubscribed_at = coalesce(unsubscribed_at, now())
    where campaign_id = p_campaign_id and contact_id = v.id;
  end if;
  perform private.site_audit(v.website_id, v.organization_id, 'email.contact_unsubscribed', v.id::text,
    jsonb_build_object('by', 'link', 'campaign', p_campaign_id));
  return jsonb_build_object('status', 'unsubscribed',
    'site_name', private.email_brand(v.website_id) ->> 'business_name');
end;
$$;

-- @part 10: staff ------------------------------------------------------------------

create or replace function public.admin_create_email_worker_key()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := encode(extensions.gen_random_bytes(24), 'hex');
  v_key text := 'lu_mail_' || v_secret;
  v_row private.email_worker_keys;
begin
  perform private.assert_platform_admin();
  perform private.hit_rate_limit('email_worker_key', (select auth.uid())::text, 10, interval '1 hour');
  update private.email_worker_keys set revoked_at = now(), revoked_by = auth.uid() where revoked_at is null;
  insert into private.email_worker_keys (key_hash, key_hint, created_by)
  values (encode(extensions.digest(v_key, 'sha256'), 'hex'), right(v_secret, 4), auth.uid())
  returning * into v_row;
  perform private.hq_log('email.worker_key_created', 'key', v_row.id::text,
    jsonb_build_object('key_hint', v_row.key_hint));
  return jsonb_build_object('key', v_key, 'key_hint', v_row.key_hint, 'created_at', v_row.created_at);
end;
$$;

create or replace function public.admin_email_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key private.email_worker_keys;
begin
  perform private.assert_platform_admin();
  select * into v_key from private.email_worker_keys where revoked_at is null;
  return jsonb_build_object(
    'key', jsonb_build_object('active', v_key.id is not null, 'key_hint', v_key.key_hint,
      'created_at', v_key.created_at, 'last_used_at', v_key.last_used_at),
    'last_event_at', (select last_event_at from private.email_webhook_status),
    'paused', coalesce((select jsonb_agg(jsonb_build_object('website_id', s.website_id, 'website_name', w.name,
        'organization_name', o.name, 'paused_at', s.paused_at, 'reason', s.paused_reason,
        'detail', s.paused_detail) order by s.paused_at desc)
      from private.email_site_state s
      join public.websites w on w.id = s.website_id
      join public.organizations o on o.id = w.organization_id
      where s.paused_at is not null), '[]'::jsonb));
end;
$$;

create or replace function public.admin_email_resume_site(p_website_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state private.email_site_state;
begin
  perform private.assert_platform_admin();
  select * into v_state from private.email_site_state where website_id = p_website_id for update;
  if not found or v_state.paused_at is null then
    return;
  end if;
  update private.email_site_state set paused_at = null, paused_reason = null, resumed_at = now(),
    resumed_by = auth.uid()
  where website_id = p_website_id;
  perform private.hq_log('email.sending_resumed', 'website', p_website_id,
    jsonb_build_object('reason', v_state.paused_reason, 'detail', v_state.paused_detail));
end;
$$;

-- @part 11: usage in Billing ------------------------------------------------------

create or replace function private.org_usage(p_org uuid, p_key text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case p_key
    when 'team_members' then private.team_seats_used(p_org)::numeric
    when 'assistant_requests_month' then (
      select coalesce(sum(u.count), 0)::numeric from public.ai_usage u
      where u.organization_id = p_org and u.feature = 'assistant'
        and u.day >= date_trunc('month', now() at time zone 'utc')::date)
    when 'media_mb' then (select round(s.bytes / 1048576.0, 1) from private.org_storage(p_org) s)
    when 'websites' then (
      select count(*)::numeric from public.websites w
      where w.organization_id = p_org and w.status <> 'archived')
    when 'emails_month' then private.email_month_usage(p_org)::numeric
  end;
$$;

create or replace function public.billing_usage(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_storage record;
begin
  if auth.uid() is null or p_org is null or not private.has_org_role(p_org, 'viewer') then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  select * into v_storage from private.org_storage(p_org);
  return jsonb_build_object(
    'period_start', v_start,
    'storage_bytes', v_storage.bytes,
    'media_files', v_storage.files,
    'chat_messages_month', (
      select count(*) from public.chat_messages c
      where c.organization_id = p_org and c.created_at >= v_start and c.deleted_at is null),
    'assistant_requests_month', private.org_usage(p_org, 'assistant_requests_month')::integer,
    'emails_month', private.email_month_usage(p_org),
    'team_members', (select count(*) from public.organization_members m where m.organization_id = p_org),
    'pending_invitations', private.team_seats_used(p_org)
      - (select count(*) from public.organization_members m where m.organization_id = p_org),
    'websites', private.org_usage(p_org, 'websites')::integer);
end;
$$;

-- @part 12: grants ----------------------------------------------------------------

revoke all on function private.email_token(uuid, integer) from public, anon, authenticated;
revoke all on function private.email_contact_before_write() from public, anon, authenticated;
revoke all on function private.email_site_org(text, text) from public, anon, authenticated;
revoke all on function private.email_campaign_for(uuid, text) from public, anon, authenticated;
revoke all on function private.email_assert_worker_key(text) from public, anon, authenticated;
revoke all on function private.email_month_start() from public, anon, authenticated;
revoke all on function private.email_month_usage(uuid) from public, anon, authenticated;
revoke all on function private.email_day_usage(text) from public, anon, authenticated;
revoke all on function private.email_daily_cap(text) from public, anon, authenticated;
revoke all on function private.email_paused(text) from public, anon, authenticated;
revoke all on function private.email_assert_can_queue(uuid, text, integer) from public, anon, authenticated;
revoke all on function private.email_brand(text) from public, anon, authenticated;
revoke all on function private.email_sender_missing(jsonb) from public, anon, authenticated;
revoke all on function private.email_assert_content(public.email_campaigns) from public, anon, authenticated;
revoke all on function private.email_campaign_stats(uuid) from public, anon, authenticated;
revoke all on function private.email_campaign_json(public.email_campaigns) from public, anon, authenticated;
revoke all on function private.email_contact_from_submission() from public, anon, authenticated;
revoke all on function private.email_start_campaign(uuid) from public, anon, authenticated;
revoke all on function private.email_claim(uuid) from public, anon, authenticated;
revoke all on function private.email_finalize(uuid) from public, anon, authenticated;
revoke all on function private.email_record(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function private.email_check_health(text, uuid) from public, anon, authenticated;
revoke all on function private.email_contact_by_token(text) from public, anon, authenticated;
revoke all on function private.org_usage(uuid, text) from public, anon, authenticated;

-- Members (signed in): each function checks the role itself.
revoke all on function public.email_overview(text) from public, anon;
revoke all on function public.email_contacts_list(text, text, text, integer, integer) from public, anon;
revoke all on function public.email_campaigns_list(text) from public, anon;
revoke all on function public.email_campaign_get(uuid) from public, anon;
revoke all on function public.email_save_sender(text, text, text, text, text) from public, anon;
revoke all on function public.email_contacts_import(text, jsonb, boolean, text) from public, anon;
revoke all on function public.email_contacts_export(text) from public, anon;
revoke all on function public.email_contact_unsubscribe(uuid) from public, anon;
revoke all on function public.email_campaign_save(text, uuid, jsonb) from public, anon;
revoke all on function public.email_campaign_test(uuid) from public, anon;
revoke all on function public.email_campaign_send(uuid) from public, anon;
revoke all on function public.email_campaign_schedule(uuid, timestamptz) from public, anon;
revoke all on function public.email_campaign_to_draft(uuid) from public, anon;
revoke all on function public.email_campaign_claim(uuid) from public, anon;
revoke all on function public.email_campaign_record(uuid, integer, jsonb) from public, anon;
revoke all on function public.admin_create_email_worker_key() from public, anon;
revoke all on function public.admin_email_status() from public, anon;
revoke all on function public.admin_email_resume_site(text) from public, anon;
revoke all on function public.billing_usage(uuid) from public, anon;
grant execute on function public.email_overview(text) to authenticated;
grant execute on function public.email_contacts_list(text, text, text, integer, integer) to authenticated;
grant execute on function public.email_campaigns_list(text) to authenticated;
grant execute on function public.email_campaign_get(uuid) to authenticated;
grant execute on function public.email_save_sender(text, text, text, text, text) to authenticated;
grant execute on function public.email_contacts_import(text, jsonb, boolean, text) to authenticated;
grant execute on function public.email_contacts_export(text) to authenticated;
grant execute on function public.email_contact_unsubscribe(uuid) to authenticated;
grant execute on function public.email_campaign_save(text, uuid, jsonb) to authenticated;
grant execute on function public.email_campaign_test(uuid) to authenticated;
grant execute on function public.email_campaign_send(uuid) to authenticated;
grant execute on function public.email_campaign_schedule(uuid, timestamptz) to authenticated;
grant execute on function public.email_campaign_to_draft(uuid) to authenticated;
grant execute on function public.email_campaign_claim(uuid) to authenticated;
grant execute on function public.email_campaign_record(uuid, integer, jsonb) to authenticated;
grant execute on function public.admin_create_email_worker_key() to authenticated;
grant execute on function public.admin_email_status() to authenticated;
grant execute on function public.admin_email_resume_site(text) to authenticated;
grant execute on function public.billing_usage(uuid) to authenticated;

-- Worker and webhook (anon + the e-mail worker key, server only): never signed-in users.
revoke all on function public.email_worker_due(text) from public, authenticated;
revoke all on function public.email_worker_claim(text, uuid) from public, authenticated;
revoke all on function public.email_worker_record(text, uuid, integer, jsonb) from public, authenticated;
revoke all on function public.email_ingest_event(text, jsonb) from public, authenticated;
grant execute on function public.email_worker_due(text) to anon;
grant execute on function public.email_worker_claim(text, uuid) to anon;
grant execute on function public.email_worker_record(text, uuid, integer, jsonb) to anon;
grant execute on function public.email_ingest_event(text, jsonb) to anon;

-- Unsubscribe page and one-click link: anyone holding a token.
revoke all on function public.email_unsubscribe_info(text) from public;
revoke all on function public.email_unsubscribe(text, uuid) from public;
grant execute on function public.email_unsubscribe_info(text) to anon, authenticated;
grant execute on function public.email_unsubscribe(text, uuid) to anon, authenticated;
