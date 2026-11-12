-- Push notifications for the member space (installed app or browser). The
-- website's server keeps the private VAPID key and sends; LevelUp only stores
-- where to send (the browser's push endpoint and keys) for each member. A
-- notification never carries the content (only "new message", "new
-- information", "renew"), like the e-mails.
-- Applied as migration portal_push.

create table if not exists private.portal_push_subscriptions (
  id bigint generated always as identity primary key,
  website_id text not null,
  customer_id uuid not null references public.portal_customers (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 1000 and endpoint ~ '^https://'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{40,200}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{10,100}$'),
  device text check (char_length(device) <= 80),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures smallint not null default 0
);
create index if not exists portal_push_customer_idx on private.portal_push_subscriptions (customer_id);
revoke all on private.portal_push_subscriptions from public, anon, authenticated;

create or replace function public.portal_push_subscribe(p_key text, p_session text, p_sub jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; v_endpoint text := p_sub ->> 'endpoint';
begin
  c := private.portal_session(p_key, p_session);
  perform private.hit_rate_limit('portal_push', c.id::text, 20, interval '1 hour');
  if p_sub is null or jsonb_typeof(p_sub) <> 'object' or v_endpoint is null
     or char_length(v_endpoint) not between 20 and 1000 or v_endpoint !~ '^https://[^\s]+$'
     or coalesce(p_sub ->> 'p256dh', '') !~ '^[A-Za-z0-9_-]{40,200}$'
     or coalesce(p_sub ->> 'auth', '') !~ '^[A-Za-z0-9_-]{10,100}$' then
    raise exception 'Invalid subscription' using errcode = '22023';
  end if;
  insert into private.portal_push_subscriptions (website_id, customer_id, endpoint, p256dh, auth, device)
  values (c.website_id, c.id, v_endpoint, p_sub ->> 'p256dh', p_sub ->> 'auth', left(private.clean_line(p_sub ->> 'device', 80), 80))
  on conflict (endpoint) do update
    set customer_id = excluded.customer_id, website_id = excluded.website_id, p256dh = excluded.p256dh,
        auth = excluded.auth, device = excluded.device, failures = 0;
  -- At most 10 devices per member: the oldest go.
  delete from private.portal_push_subscriptions s
  where s.customer_id = c.id and s.id not in (
    select x.id from private.portal_push_subscriptions x where x.customer_id = c.id order by x.created_at desc limit 10);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.portal_push_subscribe(text, text, jsonb) from public;
grant execute on function public.portal_push_subscribe(text, text, jsonb) to anon, authenticated;

create or replace function public.portal_push_unsubscribe(p_key text, p_session text, p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  delete from private.portal_push_subscriptions where customer_id = c.id and endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.portal_push_unsubscribe(text, text, text) from public;
grant execute on function public.portal_push_unsubscribe(text, text, text) to anon, authenticated;

-- After a send: a gone endpoint (404 / 410) is removed; failures counted.
create or replace function public.portal_push_result(p_key text, p_id bigint, p_ok boolean, p_gone boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text;
begin
  select website_id into v_site from private.portal_key_website(p_key);
  if coalesce(p_gone, false) then
    delete from private.portal_push_subscriptions where id = p_id and website_id = v_site;
  elsif p_ok then
    update private.portal_push_subscriptions set last_success_at = now(), failures = 0 where id = p_id and website_id = v_site;
  else
    update private.portal_push_subscriptions set failures = least(failures + 1, 100) where id = p_id and website_id = v_site;
    delete from private.portal_push_subscriptions where id = p_id and website_id = v_site and failures >= 10;
  end if;
end;
$$;
revoke all on function public.portal_push_result(text, bigint, boolean, boolean) from public;
grant execute on function public.portal_push_result(text, bigint, boolean, boolean) to anon, authenticated;

-- The outbox gives the server each member's devices with every row.
do $do$
declare
  d text := pg_get_functiondef('public.portal_outbox_claim(text,integer)'::regprocedure);
  anchor text := $a$'to', cu.email, 'name', cu.name, 'locale', cu.locale,$a$;
begin
  if position('portal_push_subscriptions' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'portal_outbox_claim: unexpected body, not patched';
  end if;
  execute replace(d, anchor, anchor || $ins$
      'push', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                        from private.portal_push_subscriptions s where s.customer_id = cu.id), '[]'::jsonb),$ins$);
end;
$do$;

-- Deleting an account also forgets its devices.
do $do$
declare
  d text := pg_get_functiondef('public.portal_delete_account_finish(text,text)'::regprocedure);
  anchor text := $a$delete from private.portal_outbox where customer_id = c.id;$a$;
begin
  if position('portal_push_subscriptions' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'portal_delete_account_finish: unexpected body, not patched';
  end if;
  execute replace(d, anchor, anchor || $ins$
  delete from private.portal_push_subscriptions where customer_id = c.id;$ins$);
end;
$do$;
