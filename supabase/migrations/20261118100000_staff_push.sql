-- Push notifications for the dashboard team (installed app on phone or desktop).
-- The dashboard server keeps the private VAPID key and sends; the database only
-- stores where to send (browser push endpoint and keys) for each team member,
-- and a queue of events filled by triggers:
--   member   a new member joined a client portal
--   message  a member wrote (or the AI assistant passed their question on)
-- A notification never carries a member's message: only "new message from
-- <first name>" and the page to open. Only editors+ of the website's
-- organization are notified.
-- Applied as migration staff_push.
--
--   staff_push_subscribe(sub, locale)       signed-in user, this device
--   staff_push_unsubscribe(endpoint)
--   staff_push_claim(key, limit)            server (LEVELUP_BILLING_KEY): what to send to whom
--   staff_push_result(key, id, ok, gone)    server: device delivered / gone

create table if not exists private.staff_push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 1000 and endpoint ~ '^https://'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{40,200}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{10,100}$'),
  locale text not null default 'en' check (locale in ('en', 'fr')),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures smallint not null default 0
);
create index if not exists staff_push_user_idx on private.staff_push_subscriptions (user_id);
revoke all on private.staff_push_subscriptions from public, anon, authenticated;

create table if not exists private.staff_push_queue (
  id bigint generated always as identity primary key,
  website_id text not null,
  kind text not null check (kind in ('member', 'message')),
  customer_id uuid references public.portal_customers (id) on delete cascade,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists staff_push_queue_pending_idx on private.staff_push_queue (created_at) where sent_at is null;
revoke all on private.staff_push_queue from public, anon, authenticated;

create or replace function private.staff_push_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'portal_customers' then
    insert into private.staff_push_queue (website_id, kind, customer_id) values (new.website_id, 'member', new.id);
  elsif new.sender = 'customer' then
    -- One pending notification per member at a time (a burst of messages is one push).
    if not exists (select 1 from private.staff_push_queue q
                   where q.customer_id = new.customer_id and q.kind = 'message' and q.sent_at is null) then
      insert into private.staff_push_queue (website_id, kind, customer_id)
      select c.website_id, 'message', c.id from public.portal_customers c where c.id = new.customer_id;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.staff_push_enqueue() from public, anon, authenticated;

drop trigger if exists staff_push_on_customer on public.portal_customers;
create trigger staff_push_on_customer after insert on public.portal_customers
  for each row execute function private.staff_push_enqueue();
drop trigger if exists staff_push_on_message on public.portal_messages;
create trigger staff_push_on_message after insert on public.portal_messages
  for each row execute function private.staff_push_enqueue();

create or replace function public.staff_push_subscribe(p_sub jsonb, p_locale text default 'en')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_endpoint text := p_sub ->> 'endpoint';
  v_p256dh text := p_sub #>> '{keys,p256dh}';
  v_auth text := p_sub #>> '{keys,auth}';
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_endpoint is null or v_endpoint !~ '^https://' or char_length(v_endpoint) not between 20 and 1000
     or coalesce(v_p256dh, '') !~ '^[A-Za-z0-9_-]+$' or char_length(v_p256dh) not between 40 and 200
     or coalesce(v_auth, '') !~ '^[A-Za-z0-9_-]+$' or char_length(v_auth) not between 10 and 100 then
    raise exception 'Invalid subscription' using errcode = '22023';
  end if;
  if (select count(*) from private.staff_push_subscriptions s where s.user_id = v_uid) >= 10 then
    delete from private.staff_push_subscriptions s
    where s.id = (select s2.id from private.staff_push_subscriptions s2 where s2.user_id = v_uid order by s2.created_at limit 1);
  end if;
  insert into private.staff_push_subscriptions (user_id, endpoint, p256dh, auth, locale)
  values (v_uid, v_endpoint, v_p256dh, v_auth, case when p_locale = 'fr' then 'fr' else 'en' end)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
    auth = excluded.auth, locale = excluded.locale, failures = 0;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.staff_push_unsubscribe(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from private.staff_push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid());
  return jsonb_build_object('ok', true);
end;
$$;

-- Server: claims pending events (marked sent) and returns one row per device to
-- notify: editors+ of the website's organization (and nobody else).
create or replace function public.staff_push_claim(p_key text, p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids bigint[];
begin
  perform private.assert_billing_key(p_key);
  delete from private.staff_push_queue where created_at < now() - interval '7 days';
  with picked as (
    select q.id from private.staff_push_queue q
    where q.sent_at is null and q.created_at > now() - interval '2 days'
    order by q.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update skip locked
  ), done as (
    update private.staff_push_queue q set sent_at = now()
    from picked where q.id = picked.id
    returning q.id
  )
  select array_agg(done.id) into v_ids from done;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'device', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'locale', s.locale,
      'kind', q.kind, 'website_id', q.website_id, 'website', w.name,
      'name', nullif(split_part(btrim(coalesce(c.name, '')), ' ', 1), ''),
      'event', q.id))
    from private.staff_push_queue q
    join public.websites w on w.id = q.website_id
    left join public.portal_customers c on c.id = q.customer_id
    join public.organization_members m on m.organization_id = w.organization_id
      and private.role_rank(m.role) >= private.role_rank('editor')
    join private.staff_push_subscriptions s on s.user_id = m.user_id and s.failures < 5
    where q.id = any (v_ids)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.staff_push_result(p_key text, p_device bigint, p_ok boolean, p_gone boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_billing_key(p_key);
  if p_gone then
    delete from private.staff_push_subscriptions where id = p_device;
  elsif p_ok then
    update private.staff_push_subscriptions set last_success_at = now(), failures = 0 where id = p_device;
  else
    update private.staff_push_subscriptions set failures = least(failures + 1, 100) where id = p_device;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.staff_push_subscribe(jsonb, text), public.staff_push_unsubscribe(text),
  public.staff_push_claim(text, integer), public.staff_push_result(text, bigint, boolean, boolean) from public, anon;
grant execute on function public.staff_push_subscribe(jsonb, text), public.staff_push_unsubscribe(text) to authenticated;
grant execute on function public.staff_push_claim(text, integer), public.staff_push_result(text, bigint, boolean, boolean)
  to anon, authenticated;
