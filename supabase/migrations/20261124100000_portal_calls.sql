-- Calls with the team, included in the member's plan or founder formula
-- (Black Pater first). Each calendar month (UTC): level 1 (Plus) 1 call,
-- level 2 (Pro) 3 calls, level 3 (Premium) 5 calls; voice for everyone, video
-- (Zoom, Google Meet, WhatsApp) for Premium; Premium group meetings on Zoom.
-- The team opens slots in the dashboard; members book one in their space.
-- The team's own number is never shown: the team calls the member (the
-- member's number is seen only by the team) or sends a meeting link.
-- Applied as migration portal_calls.
--
-- Member (portal key + session):  portal_calls_home, portal_call_book, portal_call_cancel
-- Team (signed-in editor+):       portal_admin_calls, portal_admin_call_slots_add,
--                                 portal_admin_call_slot_cancel, portal_admin_call_update

create table if not exists public.portal_call_slots (
  id uuid primary key default gen_random_uuid(),
  website_id text not null,
  organization_id uuid not null,
  starts_at timestamptz not null,
  minutes smallint not null check (minutes between 10 and 120),
  kind text not null default 'one' check (kind in ('one', 'meeting')),
  title text check (title is null or char_length(title) between 1 and 120),
  capacity smallint not null default 1 check (capacity between 1 and 300),
  link text check (link is null or (link ~ '^https://' and char_length(link) <= 500)),
  created_by uuid,
  created_at timestamptz not null default now(),
  canceled_at timestamptz,
  check (kind = 'meeting' or capacity = 1)
);
create index if not exists portal_call_slots_site_idx on public.portal_call_slots (website_id, starts_at);
alter table public.portal_call_slots enable row level security;
revoke all on public.portal_call_slots from public, anon, authenticated;

create table if not exists public.portal_calls (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.portal_call_slots (id) on delete cascade,
  website_id text not null,
  customer_id uuid not null references public.portal_customers (id) on delete cascade,
  mode text not null check (mode in ('voice', 'video', 'meeting')),
  platform text not null check (platform in ('phone', 'whatsapp', 'zoom', 'meet')),
  phone text check (phone is null or phone ~ '^\+?[0-9 ]{7,20}$'),
  topic text check (topic is null or char_length(topic) <= 500),
  status text not null default 'booked' check (status in ('booked', 'done', 'missed', 'canceled')),
  link text check (link is null or (link ~ '^https://' and char_length(link) <= 500)),
  canceled_by text check (canceled_by is null or canceled_by in ('member', 'team')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists portal_calls_customer_idx on public.portal_calls (customer_id, created_at desc);
create unique index if not exists portal_calls_one_booking on public.portal_calls (slot_id, customer_id) where status <> 'canceled';
alter table public.portal_calls enable row level security;
revoke all on public.portal_calls from public, anon, authenticated;

-- The team is told at once (push) when a member books.
alter table private.staff_push_queue drop constraint if exists staff_push_queue_kind_check;
alter table private.staff_push_queue add constraint staff_push_queue_kind_check check (kind in ('member', 'message', 'call'));

create or replace function private.portal_calls_quota(p_level smallint)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_level, 0) when 1 then 1 when 2 then 3 when 3 then 5 else 0 end::smallint;
$$;

create or replace function private.portal_calls_used(p_customer_id uuid)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::smallint
  from public.portal_calls k
  join public.portal_call_slots s on s.id = k.slot_id
  where k.customer_id = p_customer_id and k.mode <> 'meeting' and k.status in ('booked', 'done', 'missed')
    and date_trunc('month', s.starts_at at time zone 'UTC') = date_trunc('month', now() at time zone 'UTC');
$$;
revoke all on function private.portal_calls_quota(smallint), private.portal_calls_used(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- member
create or replace function public.portal_calls_home(p_key text, p_session text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
  v_level smallint;
  v_active boolean;
begin
  c := private.portal_session(p_key, p_session);
  v_active := private.portal_member_active(c.id);
  v_level := case when v_active then private.portal_customer_level(c.id) else 0 end;
  return jsonb_build_object(
    'active', v_active,
    'level', v_level,
    'quota', private.portal_calls_quota(v_level),
    'used', private.portal_calls_used(c.id),
    'video', v_level >= 3,
    'meetings_allowed', v_level >= 3,
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'minutes', s.minutes) order by s.starts_at)
      from public.portal_call_slots s
      where s.website_id = c.website_id and s.kind = 'one' and s.canceled_at is null
        and s.starts_at > now() + interval '2 hours' and s.starts_at < now() + interval '45 days'
        and not exists (select 1 from public.portal_calls k where k.slot_id = s.id and k.status <> 'canceled')), '[]'::jsonb),
    'meetings', case when v_level >= 3 then coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'minutes', s.minutes, 'title', s.title,
        'call_id', (select k.id from public.portal_calls k where k.slot_id = s.id and k.customer_id = c.id and k.status <> 'canceled' limit 1),
        'joined', exists (select 1 from public.portal_calls k where k.slot_id = s.id and k.customer_id = c.id and k.status <> 'canceled'),
        'full', (select count(*) from public.portal_calls k where k.slot_id = s.id and k.status <> 'canceled') >= s.capacity,
        'link', case when exists (select 1 from public.portal_calls k where k.slot_id = s.id and k.customer_id = c.id and k.status <> 'canceled')
                     then s.link end) order by s.starts_at)
      from public.portal_call_slots s
      where s.website_id = c.website_id and s.kind = 'meeting' and s.canceled_at is null
        and s.starts_at > now() - interval '2 hours' and s.starts_at < now() + interval '60 days'), '[]'::jsonb) else '[]'::jsonb end,
    'calls', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'starts_at', s.starts_at, 'minutes', s.minutes, 'mode', k.mode,
        'platform', k.platform, 'topic', k.topic, 'status', k.status, 'link', k.link, 'canceled_by', k.canceled_by,
        'can_cancel', k.status = 'booked' and s.starts_at > now() + interval '2 hours') order by s.starts_at desc)
      from public.portal_calls k join public.portal_call_slots s on s.id = k.slot_id
      where k.customer_id = c.id and k.mode <> 'meeting' and s.starts_at > now() - interval '60 days'), '[]'::jsonb));
end;
$$;

create or replace function public.portal_call_book(p_key text, p_session text, p_slot uuid, p_platform text,
                                                   p_phone text default null, p_topic text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
  s public.portal_call_slots;
  v_level smallint;
  v_mode text;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+ ]', '', 'g'), '');
  v_topic text := private.check_text(p_topic, 500, 'topic', true);
  v_id uuid;
begin
  c := private.portal_session(p_key, p_session);
  perform private.hit_rate_limit('portal_call_book', c.id::text, 20, interval '1 hour');
  if not private.portal_member_active(c.id) then
    raise exception 'membership_expired' using errcode = 'PT402';
  end if;
  v_level := private.portal_customer_level(c.id);
  select * into s from public.portal_call_slots where id = p_slot and website_id = c.website_id and canceled_at is null for update;
  if s.id is null then
    raise exception 'Unknown slot' using errcode = 'PT404';
  end if;
  if p_platform is null or p_platform not in ('phone', 'whatsapp', 'zoom', 'meet') then
    raise exception 'Invalid platform' using errcode = '22023';
  end if;

  if s.kind = 'meeting' then
    if v_level < 3 then
      raise exception 'plan_required' using errcode = 'PT413';
    end if;
    if s.starts_at < now() - interval '2 hours' then
      raise exception 'Slot passed' using errcode = '22023';
    end if;
    if (select count(*) from public.portal_calls k where k.slot_id = s.id and k.status <> 'canceled') >= s.capacity then
      raise exception 'slot_taken' using errcode = 'PT409';
    end if;
    insert into public.portal_calls (slot_id, website_id, customer_id, mode, platform, topic)
    values (s.id, s.website_id, c.id, 'meeting', 'zoom', v_topic)
    on conflict do nothing
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  if s.starts_at <= now() + interval '2 hours' then
    raise exception 'Slot too soon' using errcode = '22023';
  end if;
  if private.portal_calls_used(c.id) >= private.portal_calls_quota(v_level) then
    raise exception 'calls_used_up' using errcode = 'PT412';
  end if;
  v_mode := case when p_platform in ('zoom', 'meet') then 'video' else 'voice' end;
  if v_mode = 'video' and v_level < 3 then
    raise exception 'plan_required' using errcode = 'PT413';
  end if;
  if p_platform in ('phone', 'whatsapp') and (v_phone is null or v_phone !~ '^\+?[0-9 ]{7,20}$') then
    raise exception 'Invalid phone' using errcode = '22023';
  end if;
  if exists (select 1 from public.portal_calls k where k.slot_id = s.id and k.status <> 'canceled') then
    raise exception 'slot_taken' using errcode = 'PT409';
  end if;
  insert into public.portal_calls (slot_id, website_id, customer_id, mode, platform, phone, topic)
  values (s.id, s.website_id, c.id, v_mode, p_platform, case when p_platform in ('phone', 'whatsapp') then v_phone end, v_topic)
  returning id into v_id;
  insert into private.staff_push_queue (website_id, kind, customer_id) values (c.website_id, 'call', c.id);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.portal_call_cancel(p_key text, p_session text, p_call uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
  k public.portal_calls;
  v_start timestamptz;
begin
  c := private.portal_session(p_key, p_session);
  select * into k from public.portal_calls where id = p_call and customer_id = c.id;
  if k.id is null or k.status <> 'booked' then
    raise exception 'Unknown call' using errcode = 'PT404';
  end if;
  select starts_at into v_start from public.portal_call_slots where id = k.slot_id;
  if k.mode <> 'meeting' and v_start <= now() + interval '2 hours' then
    raise exception 'Too late to cancel' using errcode = '22023';
  end if;
  update public.portal_calls set status = 'canceled', canceled_by = 'member', updated_at = now() where id = k.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- team
create or replace function public.portal_admin_calls(p_website_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.portal_manage_site(p_website_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'starts_at', s.starts_at, 'minutes', s.minutes, 'kind', s.kind, 'title', s.title,
      'capacity', s.capacity, 'link', s.link, 'canceled_at', s.canceled_at,
      'bookings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', k.id, 'customer_id', k.customer_id, 'name', c.name, 'email', c.email, 'mode', k.mode,
          'platform', k.platform, 'phone', k.phone, 'topic', k.topic, 'status', k.status, 'link', k.link,
          'canceled_by', k.canceled_by) order by k.created_at)
        from public.portal_calls k join public.portal_customers c on c.id = k.customer_id
        where k.slot_id = s.id), '[]'::jsonb)) order by s.starts_at)
    from public.portal_call_slots s
    where s.website_id = p_website_id and s.starts_at > now() - interval '14 days'), '[]'::jsonb);
end;
$$;

create or replace function public.portal_admin_call_slots_add(p_website_id text, p_starts timestamptz[], p_minutes integer,
                                                              p_kind text default 'one', p_title text default null,
                                                              p_capacity integer default null, p_link text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_n integer;
begin
  v_org := private.portal_manage_site(p_website_id);
  if p_starts is null or cardinality(p_starts) not between 1 and 60 then
    raise exception 'Choose between 1 and 60 slots' using errcode = '22023';
  end if;
  if p_kind not in ('one', 'meeting') or p_minutes is null or p_minutes not between 10 and 120 then
    raise exception 'Invalid slot' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_starts) t where t < now() or t > now() + interval '180 days') then
    raise exception 'Slots must be in the next 180 days' using errcode = '22023';
  end if;
  if p_link is not null and (p_link !~ '^https://' or char_length(p_link) > 500) then
    raise exception 'Invalid link' using errcode = '22023';
  end if;
  insert into public.portal_call_slots (website_id, organization_id, starts_at, minutes, kind, title, capacity, link, created_by)
  select p_website_id, v_org, t, p_minutes, p_kind,
         case when p_kind = 'meeting' then coalesce(private.check_text(p_title, 120, 'title', true), 'Réunion Premium') end,
         case when p_kind = 'meeting' then least(greatest(coalesce(p_capacity, 50), 1), 300) else 1 end,
         nullif(btrim(coalesce(p_link, '')), ''), (select auth.uid())
  from (select distinct unnest(p_starts) as t) x
  where not exists (select 1 from public.portal_call_slots s
                    where s.website_id = p_website_id and s.starts_at = x.t and s.kind = p_kind and s.canceled_at is null);
  get diagnostics v_n = row_count;
  perform private.site_audit(p_website_id, v_org, 'portal.call_slots_added', null, jsonb_build_object('count', v_n, 'kind', p_kind));
  return jsonb_build_object('ok', true, 'added', v_n);
end;
$$;

create or replace function public.portal_admin_call_slot_cancel(p_slot uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.portal_call_slots;
  v_org uuid;
begin
  select * into s from public.portal_call_slots where id = p_slot;
  if s.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_org := private.portal_manage_site(s.website_id);
  update public.portal_call_slots set canceled_at = now() where id = s.id and canceled_at is null;
  update public.portal_calls set status = 'canceled', canceled_by = 'team', updated_at = now()
   where slot_id = s.id and status = 'booked';
  perform private.site_audit(s.website_id, v_org, 'portal.call_slot_canceled', s.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.portal_admin_call_update(p_call uuid, p_status text default null, p_link text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.portal_calls;
begin
  select * into k from public.portal_calls where id = p_call;
  if k.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.portal_manage_site(k.website_id);
  if p_status is not null and p_status not in ('booked', 'done', 'missed', 'canceled') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  if p_link is not null and btrim(p_link) <> '' and (p_link !~ '^https://' or char_length(p_link) > 500) then
    raise exception 'Invalid link' using errcode = '22023';
  end if;
  update public.portal_calls
     set status = coalesce(p_status, status),
         canceled_by = case when p_status = 'canceled' then 'team' else canceled_by end,
         link = case when p_link is null then link else nullif(btrim(p_link), '') end,
         updated_at = now()
   where id = k.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.portal_calls_home(text, text), public.portal_call_book(text, text, uuid, text, text, text),
  public.portal_call_cancel(text, text, uuid), public.portal_admin_calls(text),
  public.portal_admin_call_slots_add(text, timestamptz[], integer, text, text, integer, text),
  public.portal_admin_call_slot_cancel(uuid), public.portal_admin_call_update(uuid, text, text) from public;
grant execute on function public.portal_calls_home(text, text), public.portal_call_book(text, text, uuid, text, text, text),
  public.portal_call_cancel(text, text, uuid) to anon, authenticated;
grant execute on function public.portal_admin_calls(text),
  public.portal_admin_call_slots_add(text, timestamptz[], integer, text, text, integer, text),
  public.portal_admin_call_slot_cancel(uuid), public.portal_admin_call_update(uuid, text, text) to authenticated;
revoke execute on function public.portal_admin_calls(text),
  public.portal_admin_call_slots_add(text, timestamptz[], integer, text, text, integer, text),
  public.portal_admin_call_slot_cancel(uuid), public.portal_admin_call_update(uuid, text, text) from anon;
