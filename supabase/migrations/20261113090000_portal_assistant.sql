-- Client portal AI assistant (first site: Black Pater).
--
-- * Dossier: the website's server saves the questionnaire answers before the
--   payment page (portal_profile_draft, keyed by the purchase attempt); the
--   payment links the draft to the member (portal_customers.profile).
-- * Knowledge: notes the owner writes in the dashboard (portal_knowledge); the
--   assistant leans on them first.
-- * Thread: questions and answers per member (private.portal_ai_messages).
--   The AI runs on the LevelUp dashboard server (/api/portal/assistant): it
--   calls portal_ai_begin (checks the portal key, the member session, the
--   membership and the daily quota, returns the context), then portal_ai_finish.
--   AI keys never leave LevelUp.
-- * Handoff: "Ask Black Pater" turns a question into a message in the member's
--   thread with an owner-only brief (summary + prepared reply). The owner's
--   answer (portal_admin_answer_handoff) is marked "validated" for the member.

-- ---------------------------------------------------------------- dossier

alter table public.portal_customers
  add column if not exists profile jsonb
    check (profile is null or (jsonb_typeof(profile) = 'object' and pg_column_size(profile) <= 16000)),
  add column if not exists profile_updated_at timestamptz;

create table if not exists private.portal_profile_drafts (
  id bigint generated always as identity primary key,
  website_id text not null,
  attempt_id text not null check (attempt_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  email text check (email is null or char_length(email) <= 254),
  profile jsonb not null check (jsonb_typeof(profile) = 'object' and pg_column_size(profile) <= 16000),
  created_at timestamptz not null default now(),
  unique (website_id, attempt_id)
);
create index if not exists portal_profile_drafts_email_idx
  on private.portal_profile_drafts (website_id, email, created_at desc);
create index if not exists portal_profile_drafts_created_idx
  on private.portal_profile_drafts (created_at);
alter table private.portal_profile_drafts enable row level security;

-- Saved by the website's server just before the payment page. 30 per hour
-- per visitor (hashed IP sent by the server), 2000 per day per site.
create or replace function public.portal_profile_draft(p_key text, p_attempt text, p_profile jsonb, p_client text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text; v_org uuid; v_email text;
begin
  select website_id, organization_id into v_site, v_org from private.portal_key_website(p_key);
  if p_attempt is null or p_attempt !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Invalid attempt' using errcode = '22023';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' or pg_column_size(p_profile) > 16000 then
    raise exception 'Invalid dossier' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('portal_profile_draft', v_site || ':' || left(coalesce(p_client, '-'), 128), 30, interval '1 hour');
  perform private.hit_rate_limit('portal_profile_draft_site', v_site, 2000, interval '1 day');
  v_email := lower(btrim(coalesce(p_profile ->> 'email', '')));
  if not private.is_valid_email(v_email) then
    v_email := null;
  end if;
  insert into private.portal_profile_drafts (website_id, attempt_id, email, profile)
  values (v_site, p_attempt, v_email, p_profile)
  on conflict (website_id, attempt_id) do update
    set email = excluded.email, profile = excluded.profile, created_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- After the member exists (site_payments_portal_customer runs first: trigger
-- names sort alphabetically), the dossier of this purchase becomes theirs.
create or replace function private.portal_profile_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; d private.portal_profile_drafts; v_email text;
begin
  if new.status <> 'paid' or (tg_op = 'UPDATE' and old.status = 'paid') then
    return new;
  end if;
  if not private.portal_enabled(new.website_id) then
    return new;
  end if;
  v_email := lower(btrim(coalesce(new.customer_email, '')));
  if coalesce(new.metadata ->> 'portal_customer_id', '') ~ '^[0-9a-f-]{36}$' then
    select * into c from public.portal_customers
    where id = (new.metadata ->> 'portal_customer_id')::uuid and website_id = new.website_id;
  end if;
  if c.id is null and v_email <> '' then
    select * into c from public.portal_customers
    where website_id = new.website_id and status = 'active' and (email = v_email or v_email = any (payment_emails))
    limit 1;
  end if;
  if c.id is null or c.status <> 'active' then
    return new;
  end if;
  select * into d from private.portal_profile_drafts
  where website_id = new.website_id and attempt_id = new.metadata ->> 'attempt_id';
  if d.id is null then
    select * into d from private.portal_profile_drafts
    where website_id = new.website_id and email = any (array_append(c.payment_emails, c.email))
      and created_at > now() - interval '7 days'
    order by created_at desc limit 1;
  end if;
  if d.id is not null and (c.profile_updated_at is null or d.created_at > c.profile_updated_at) then
    update public.portal_customers set profile = d.profile, profile_updated_at = d.created_at
    where id = c.id;
  end if;
  return new;
end;
$$;
revoke all on function private.portal_profile_from_payment() from public, anon, authenticated;

drop trigger if exists site_payments_portal_dossier on public.site_payments;
create trigger site_payments_portal_dossier after insert or update of status on public.site_payments
  for each row execute function private.portal_profile_from_payment();

-- ---------------------------------------------------------------- knowledge

create table if not exists public.portal_knowledge (
  id uuid primary key default gen_random_uuid(),
  website_id text not null,
  organization_id uuid not null,
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 8000),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);
create index if not exists portal_knowledge_site_idx on public.portal_knowledge (website_id, updated_at desc);
alter table public.portal_knowledge enable row level security;
revoke all on public.portal_knowledge from anon, authenticated;
drop trigger if exists portal_knowledge_updated_at on public.portal_knowledge;
create trigger portal_knowledge_updated_at before update on public.portal_knowledge
  for each row execute function private.set_updated_at();

alter table public.portal_settings
  add column if not exists assistant_enabled boolean not null default false,
  add column if not exists assistant_daily smallint not null default 20
    check (assistant_daily between 1 and 200);

-- ---------------------------------------------------------------- thread

create table if not exists private.portal_ai_messages (
  id uuid primary key default gen_random_uuid(),
  website_id text not null,
  organization_id uuid not null,
  customer_id uuid not null references public.portal_customers (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'owner')),
  body text not null check (char_length(body) between 1 and 12000),
  sources jsonb not null default '[]'::jsonb
    check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 12),
  -- Assistant rows: the question they answer.
  question_id uuid references private.portal_ai_messages (id) on delete cascade,
  handoff_message_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists portal_ai_messages_thread_idx on private.portal_ai_messages (customer_id, created_at);
create unique index if not exists portal_ai_messages_answer_idx on private.portal_ai_messages (question_id)
  where question_id is not null;
create index if not exists portal_ai_messages_site_idx on private.portal_ai_messages (website_id, created_at);
alter table private.portal_ai_messages enable row level security;

alter table public.portal_messages
  add column if not exists via text check (via is null or via = 'assistant'),
  -- Owner-only: what the assistant prepared (summary, prepared reply, its answer).
  add column if not exists ai_brief jsonb
    check (ai_brief is null or (jsonb_typeof(ai_brief) = 'object' and pg_column_size(ai_brief) <= 24000)),
  -- Owner answer to an "Ask Black Pater" message: shown as validated.
  add column if not exists reply_to uuid references public.portal_messages (id) on delete set null;

create or replace function private.portal_ai_json(m private.portal_ai_messages)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', m.id, 'role', m.role, 'body', m.body, 'sources', m.sources,
                            'question_id', m.question_id,
                            'handed_off', m.handoff_message_id is not null, 'created_at', m.created_at);
$$;

create or replace function private.portal_ai_used_today(p_customer_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from private.portal_ai_messages
  where customer_id = p_customer_id and role = 'user' and created_at > now() - interval '24 hours';
$$;

-- What the member's assistant screen shows.
create or replace function public.portal_ai_thread(p_key text, p_session text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; st public.portal_settings;
begin
  c := private.portal_session(p_key, p_session);
  select * into st from public.portal_settings where website_id = c.website_id;
  return jsonb_build_object(
    'enabled', coalesce(st.assistant_enabled, false),
    'active', private.portal_member_active(c.id),
    'daily', coalesce(st.assistant_daily, 20),
    'used', private.portal_ai_used_today(c.id),
    'messages', coalesce((
      select jsonb_agg(private.portal_ai_json(x) order by x.created_at)
      from (select * from private.portal_ai_messages where customer_id = c.id
            order by created_at desc limit 60) x), '[]'::jsonb));
end;
$$;

-- Starts one answer: stores the question and returns what the AI may know.
-- Errors: PT402 membership ended, PT404 assistant off, PT429 quota reached.
create or replace function public.portal_ai_begin(p_key text, p_session text, p_question text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; st public.portal_settings; v_q text; q private.portal_ai_messages;
  v_offers text[]; v_site_name text;
begin
  c := private.portal_session(p_key, p_session);
  select * into st from public.portal_settings where website_id = c.website_id;
  if not coalesce(st.assistant_enabled, false) then
    raise exception 'Assistant off' using errcode = 'PT404';
  end if;
  if not private.portal_member_active(c.id) then
    raise exception 'Membership expired' using errcode = 'PT402';
  end if;
  v_q := private.check_text(p_question, 2000, 'question', true);
  if v_q is null or v_q = '' then
    raise exception 'Empty question' using errcode = '22023';
  end if;
  if private.portal_ai_used_today(c.id) >= coalesce(st.assistant_daily, 20) then
    raise exception 'Daily limit' using errcode = 'PT429';
  end if;
  -- Site-wide safety net and burst guard.
  if (select count(*) from private.portal_ai_messages
      where website_id = c.website_id and role = 'user' and created_at > now() - interval '24 hours') >= 3000 then
    raise exception 'Site limit' using errcode = 'PT429';
  end if;
  perform private.hit_rate_limit('portal_ai_minute', c.id::text, 6, interval '1 minute');

  insert into private.portal_ai_messages (website_id, organization_id, customer_id, role, body)
  values (c.website_id, c.organization_id, c.id, 'user', v_q)
  returning * into q;

  v_offers := private.portal_customer_offers(c.id);
  select coalesce(nullif(w.name, ''), w.id) into v_site_name from public.websites w where w.id = c.website_id;

  return jsonb_build_object(
    'question_id', q.id,
    'question', q.body,
    'site', v_site_name,
    'today', now(),
    'member', jsonb_build_object(
      'name', c.name, 'locale', c.locale, 'member_since', c.created_at,
      'member_until', c.member_until, 'level', private.portal_customer_level(c.id)),
    'profile', c.profile,
    'knowledge', coalesce((
      select jsonb_agg(jsonb_build_object('title', k.title, 'body', k.body) order by k.updated_at desc)
      from (select * from public.portal_knowledge
            where website_id = c.website_id and active order by updated_at desc limit 40) k), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('title', i.title, 'body', left(coalesce(i.body, ''), 800),
                                          'kind', i.kind, 'published_at', i.published_at)
                       order by i.published_at desc)
      from (select * from public.portal_items pi
            where pi.website_id = c.website_id and private.portal_item_visible(pi, c.id, v_offers)
            order by pi.published_at desc limit 15) i), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('from', m.sender, 'body', left(m.body, 800), 'at', m.created_at)
                       order by m.created_at)
      from (select * from public.portal_messages where customer_id = c.id
            order by created_at desc limit 12) m), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('role', h.role, 'body', left(h.body, 2000)) order by h.created_at)
      from (select * from private.portal_ai_messages where customer_id = c.id and id <> q.id
            order by created_at desc limit 10) h), '[]'::jsonb));
end;
$$;

-- Stores the answer, or (p_body null) withdraws the question when the AI
-- could not answer, so it does not count against the member's quota.
create or replace function public.portal_ai_finish(
  p_key text, p_session text, p_question_id uuid, p_body text, p_sources jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; q private.portal_ai_messages; a private.portal_ai_messages; v_sources jsonb;
begin
  c := private.portal_session(p_key, p_session);
  select * into q from private.portal_ai_messages
  where id = p_question_id and customer_id = c.id and role = 'user' and created_at > now() - interval '10 minutes';
  if q.id is null then
    raise exception 'Unknown question' using errcode = 'PT404';
  end if;
  if exists (select 1 from private.portal_ai_messages where question_id = q.id) then
    raise exception 'Already answered' using errcode = '22023';
  end if;
  if p_body is null then
    delete from private.portal_ai_messages where id = q.id;
    return jsonb_build_object('ok', true);
  end if;
  -- Sources: https links only, short titles.
  select coalesce(jsonb_agg(jsonb_build_object('url', s ->> 'url', 'title', left(coalesce(s ->> 'title', ''), 200))), '[]'::jsonb)
  into v_sources
  from (select s from jsonb_array_elements(case when jsonb_typeof(p_sources) = 'array' then p_sources else '[]'::jsonb end) s
        where jsonb_typeof(s) = 'object' and (s ->> 'url') ~ '^https://[^\s<>"]+$' and char_length(s ->> 'url') <= 2000
        limit 10) x;
  insert into private.portal_ai_messages (website_id, organization_id, customer_id, role, body, sources, question_id)
  values (c.website_id, c.organization_id, c.id, 'assistant', left(p_body, 12000), v_sources, q.id)
  returning * into a;
  return private.portal_ai_json(a);
end;
$$;

-- "Ask Black Pater": the question goes to the owner's messages with a brief
-- the member never sees (summary, prepared reply, the assistant's answer).
create or replace function public.portal_ai_handoff(
  p_key text, p_session text, p_question_id uuid, p_summary text, p_draft text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; q private.portal_ai_messages; v_answer text; v_id uuid;
begin
  c := private.portal_session(p_key, p_session);
  if not private.portal_member_active(c.id) then
    raise exception 'Membership expired' using errcode = 'PT402';
  end if;
  select * into q from private.portal_ai_messages
  where id = p_question_id and customer_id = c.id and role = 'user';
  if q.id is null then
    raise exception 'Unknown question' using errcode = 'PT404';
  end if;
  if q.handoff_message_id is not null then
    return jsonb_build_object('ok', true, 'id', q.handoff_message_id);
  end if;
  perform private.hit_rate_limit('portal_message_hour', c.id::text, 10, interval '1 hour');
  perform private.hit_rate_limit('portal_message_day', c.id::text, 30, interval '1 day');
  select a.body into v_answer from private.portal_ai_messages a
  where a.question_id = q.id;
  insert into public.portal_messages (website_id, organization_id, customer_id, sender, body, via, ai_brief)
  values (c.website_id, c.organization_id, c.id, 'customer', left(q.body, 4000), 'assistant',
          jsonb_strip_nulls(jsonb_build_object(
            'summary', left(private.clean_text(coalesce(p_summary, ''), 100000), 2000),
            'draft', left(private.clean_text(coalesce(p_draft, ''), 100000), 4000),
            'answer', left(v_answer, 6000))))
  returning id into v_id;
  update private.portal_ai_messages set handoff_message_id = v_id where id = q.id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- What the handoff brief is written from (read before portal_ai_handoff).
create or replace function public.portal_ai_handoff_context(p_key text, p_session text, p_question_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; q private.portal_ai_messages;
begin
  c := private.portal_session(p_key, p_session);
  select * into q from private.portal_ai_messages
  where id = p_question_id and customer_id = c.id and role = 'user';
  if q.id is null then
    raise exception 'Unknown question' using errcode = 'PT404';
  end if;
  return jsonb_build_object(
    'question', q.body,
    'handed_off', q.handoff_message_id is not null,
    'answer', (select a.body from private.portal_ai_messages a where a.question_id = q.id),
    'profile', c.profile,
    'site', (select coalesce(nullif(w.name, ''), w.id) from public.websites w where w.id = c.website_id));
end;
$$;

-- ---------------------------------------------------------------- dashboard

create or replace function public.portal_admin_assistant(p_website_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.portal_settings;
begin
  perform private.portal_manage_site(p_website_id);
  select * into st from public.portal_settings where website_id = p_website_id;
  return jsonb_build_object(
    'enabled', coalesce(st.assistant_enabled, false),
    'daily', coalesce(st.assistant_daily, 20),
    'questions_today', (select count(*) from private.portal_ai_messages
                        where website_id = p_website_id and role = 'user' and created_at > now() - interval '24 hours'),
    'questions_month', (select count(*) from private.portal_ai_messages
                        where website_id = p_website_id and role = 'user' and created_at > now() - interval '30 days'),
    'handoffs_open', (select count(*) from public.portal_messages m
                      where m.website_id = p_website_id and m.via = 'assistant'
                        and not exists (select 1 from public.portal_messages r where r.reply_to = m.id)),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'body', k.body, 'active', k.active,
                                          'updated_at', k.updated_at) order by k.updated_at desc)
      from public.portal_knowledge k where k.website_id = p_website_id), '[]'::jsonb));
end;
$$;

create or replace function public.portal_admin_assistant_settings(p_website_id text, p_enabled boolean, p_daily integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := private.portal_manage_site(p_website_id);
  perform private.assert_org_unlocked(v_org);
  if p_enabled is null or p_daily is null or p_daily < 1 or p_daily > 200 then
    raise exception 'Invalid settings' using errcode = '22023';
  end if;
  insert into public.portal_settings (website_id, organization_id, assistant_enabled, assistant_daily, updated_by)
  values (p_website_id, v_org, p_enabled, p_daily, (select auth.uid()))
  on conflict (website_id) do update
    set assistant_enabled = excluded.assistant_enabled, assistant_daily = excluded.assistant_daily,
        updated_at = now(), updated_by = excluded.updated_by;
  perform private.site_audit(p_website_id, v_org, 'portal.assistant_settings', p_website_id,
    jsonb_build_object('enabled', p_enabled, 'daily', p_daily));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.portal_admin_knowledge_save(
  p_website_id text, p_id uuid, p_title text, p_body text, p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_title text; v_body text; v_id uuid;
begin
  v_org := private.portal_manage_site(p_website_id);
  perform private.assert_org_unlocked(v_org);
  v_title := private.check_text(p_title, 160, 'title', false);
  v_body := private.check_text(p_body, 8000, 'body', true);
  if coalesce(v_title, '') = '' or coalesce(v_body, '') = '' then
    raise exception 'Empty note' using errcode = '22023';
  end if;
  if p_id is null then
    if (select count(*) from public.portal_knowledge where website_id = p_website_id) >= 200 then
      raise exception 'Too many notes' using errcode = 'PT429';
    end if;
    insert into public.portal_knowledge (website_id, organization_id, title, body, active, created_by)
    values (p_website_id, v_org, v_title, v_body, coalesce(p_active, true), (select auth.uid()))
    returning id into v_id;
  else
    update public.portal_knowledge set title = v_title, body = v_body, active = coalesce(p_active, active)
    where id = p_id and website_id = p_website_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Not found' using errcode = 'PT404';
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.portal_admin_knowledge_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text; v_org uuid;
begin
  select website_id into v_site from public.portal_knowledge where id = p_id;
  if v_site is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_org := private.portal_manage_site(v_site);
  perform private.assert_org_unlocked(v_org);
  delete from public.portal_knowledge where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- The owner answers an "Ask Black Pater" message: a normal reply (e-mail /
-- push to the member) marked validated, also shown in the assistant thread.
create or replace function public.portal_admin_answer_handoff(p_message_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.portal_messages; c public.portal_customers; v_org uuid; v_body text; v_id uuid;
begin
  select * into m from public.portal_messages where id = p_message_id and via = 'assistant';
  if m.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into c from public.portal_customers where id = m.customer_id;
  v_org := private.portal_manage_site(c.website_id);
  perform private.assert_org_unlocked(v_org);
  v_body := private.check_text(p_body, 4000, 'message', true);
  if coalesce(v_body, '') = '' then
    raise exception 'Empty message' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('portal_reply', c.website_id, 300, interval '1 day');
  insert into public.portal_messages (website_id, organization_id, customer_id, sender, author_id, body, reply_to)
  values (c.website_id, v_org, c.id, 'owner', (select auth.uid()), v_body, m.id)
  returning id into v_id;
  update public.portal_messages set read_at = coalesce(read_at, now()) where id = m.id;
  insert into private.portal_ai_messages (website_id, organization_id, customer_id, role, body, handoff_message_id)
  values (c.website_id, v_org, c.id, 'owner', v_body, m.id);
  if c.status = 'active' then
    insert into private.portal_outbox (website_id, customer_id, kind) values (c.website_id, c.id, 'message');
  end if;
  perform private.site_audit(c.website_id, v_org, 'portal.message_sent', c.id::text,
    jsonb_build_object('message_id', v_id, 'handoff', m.id));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- The member's dossier, for the owner.
create or replace function public.portal_admin_profile(p_customer_id uuid)
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
  return jsonb_build_object('profile', c.profile, 'updated_at', c.profile_updated_at);
end;
$$;

-- ---------------------------------------------------------------- existing functions

-- Member side: which messages came through the assistant, which replies are validated.
-- Owner side: the brief and whether a handoff was answered.
do $patch$
declare
  v_fn regprocedure; v_def text; v_new text;
  v_member text := $a$'via', m.via, 'validated', m.reply_to is not null, $a$;
  v_owner text := $a$'via', m.via, 'brief', m.ai_brief, 'reply_to', m.reply_to,
                                        'answered', exists (select 1 from public.portal_messages r where r.reply_to = m.id), $a$;
  v_anchor text := $a$jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body,$a$;
begin
  foreach v_fn in array array[
    'public.portal_home(text,text)'::regprocedure,
    'public.portal_messages_since(text,text,timestamptz)'::regprocedure,
    'public.portal_admin_thread(uuid)'::regprocedure]
  loop
    v_def := pg_get_functiondef(v_fn);
    if position($a$'via', m.via$a$ in v_def) > 0 then
      continue; -- already patched
    end if;
    if position(v_anchor in v_def) = 0 then
      raise exception 'anchor not found in %', v_fn;
    end if;
    v_new := replace(v_def, v_anchor,
      v_anchor || ' ' || case when v_fn = 'public.portal_admin_thread(uuid)'::regprocedure then v_owner else v_member end);
    execute v_new;
  end loop;
end;
$patch$;

-- Deleting the account also deletes the assistant thread (cascade on
-- portal_customers would not run: the account row is kept, anonymized).
do $patch$
declare
  v_def text; v_anchor text := 'delete from public.portal_messages where customer_id = c.id;';
begin
  v_def := pg_get_functiondef('public.portal_delete_account_finish(text,text)'::regprocedure);
  if position('portal_ai_messages' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'anchor not found in portal_delete_account_finish';
  end if;
  execute replace(v_def, v_anchor, v_anchor ||
    ' delete from private.portal_ai_messages where customer_id = c.id;' ||
    ' delete from private.portal_profile_drafts where website_id = c.website_id and email = any (array_append(c.payment_emails, c.email));' ||
    ' update public.portal_customers set profile = null, profile_updated_at = null where id = c.id;');
end;
$patch$;

-- Old drafts (never paid) are removed after 30 days.
create or replace function private.portal_profile_drafts_cleanup()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.portal_profile_drafts where created_at < now() - interval '30 days';
$$;
revoke all on function private.portal_profile_drafts_cleanup() from public, anon, authenticated;
select cron.schedule('portal-profile-drafts-cleanup', '40 3 * * *', 'select private.portal_profile_drafts_cleanup()');

-- ---------------------------------------------------------------- grants

revoke all on function
  private.portal_ai_json(private.portal_ai_messages),
  private.portal_ai_used_today(uuid)
from public, anon, authenticated;

revoke all on function
  public.portal_ai_handoff_context(text, text, uuid),
  public.portal_profile_draft(text, text, jsonb, text),
  public.portal_ai_thread(text, text),
  public.portal_ai_begin(text, text, text),
  public.portal_ai_finish(text, text, uuid, text, jsonb),
  public.portal_ai_handoff(text, text, uuid, text, text),
  public.portal_admin_assistant(text),
  public.portal_admin_assistant_settings(text, boolean, integer),
  public.portal_admin_knowledge_save(text, uuid, text, text, boolean),
  public.portal_admin_knowledge_delete(uuid),
  public.portal_admin_answer_handoff(uuid, text),
  public.portal_admin_profile(uuid)
from public;

-- Website servers (portal key checked inside).
grant execute on function
  public.portal_ai_handoff_context(text, text, uuid),
  public.portal_profile_draft(text, text, jsonb, text),
  public.portal_ai_thread(text, text),
  public.portal_ai_begin(text, text, text),
  public.portal_ai_finish(text, text, uuid, text, jsonb),
  public.portal_ai_handoff(text, text, uuid, text, text)
to anon, authenticated;

-- Dashboard editors (role checked inside).
grant execute on function
  public.portal_admin_assistant(text),
  public.portal_admin_assistant_settings(text, boolean, integer),
  public.portal_admin_knowledge_save(text, uuid, text, text, boolean),
  public.portal_admin_knowledge_delete(uuid),
  public.portal_admin_answer_handoff(uuid, text),
  public.portal_admin_profile(uuid)
to authenticated;
