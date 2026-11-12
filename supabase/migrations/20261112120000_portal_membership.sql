-- Monthly membership, no automatic charge. Each paid month is a period:
-- joining or renewing extends the membership (portal_customers.member_until),
-- buying a plan for a month raises what the member can read. Nothing is ever
-- charged automatically: before the end, the member is reminded (outbox
-- 'renew', J-7 / J-3 / J-1 / day of the end) and renews from the client space.
-- Without renewal, information and sending messages stop at the end date; the
-- member can still sign in, read past messages, renew or delete the account.
-- Refunds shorten the matching period.

-- ------------------------------------------------------------ settings and state

alter table public.portal_settings
  add column if not exists membership_monthly boolean not null default false,
  add column if not exists period_days smallint not null default 30 check (period_days between 7 and 366);

alter table public.portal_customers
  add column if not exists member_until timestamptz,
  add column if not exists reminders_off boolean not null default false;

create table if not exists public.portal_periods (
  id uuid primary key default gen_random_uuid(),
  website_id text not null references public.websites (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null references public.portal_customers (id) on delete cascade,
  kind text not null check (kind in ('membership', 'plan', 'manual')),
  plan_id uuid references public.portal_plans (id) on delete set null,
  plan_name text check (char_length(plan_name) <= 60),
  level smallint not null default 0 check (level between 0 and 3),
  payment_id uuid unique references public.site_payments (id) on delete set null,
  amount bigint,
  currency text,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at >= starts_at),
  canceled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists portal_periods_customer_idx on public.portal_periods (customer_id, kind, ends_at desc);
alter table public.portal_periods enable row level security;
revoke all on public.portal_periods from public, anon, authenticated;

alter table private.portal_outbox drop constraint if exists portal_outbox_kind_check;
alter table private.portal_outbox add constraint portal_outbox_kind_check
  check (kind in ('access', 'update', 'message', 'signin', 'renew'));

-- Black Pater sells its membership month by month.
insert into public.portal_settings (website_id, organization_id, membership_monthly)
select w.id, w.organization_id, true from public.websites w where w.id = 'ws_ab9493c5857ed460'
on conflict (website_id) do update set membership_monthly = true, updated_at = now();

-- Members who joined before monthly membership (the founders): one month from now.
update public.portal_customers c
   set member_until = now() + interval '30 days'
 where c.website_id = 'ws_ab9493c5857ed460' and c.status = 'active' and c.member_until is null;

-- ------------------------------------------------------------ helpers

-- True when the member can use the space now (always true where membership is not monthly).
create or replace function private.portal_member_active(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select not coalesce(st.membership_monthly, false) or (c.member_until is not null and c.member_until > now())
    from public.portal_customers c
    left join public.portal_settings st on st.website_id = c.website_id
    where c.id = p_customer_id), false);
$$;
revoke all on function private.portal_member_active(uuid) from public, anon, authenticated;

-- What the member can read now: the best of a running monthly plan, an old
-- subscription (2-day grace) and the free offer.
create or replace function private.portal_customer_level(p_customer_id uuid)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((select max(p.level) from public.portal_periods p
              where p.customer_id = p_customer_id and p.kind = 'plan' and p.canceled_at is null
                and p.starts_at <= now() and p.ends_at > now()), 0),
    coalesce((select max(s.level) from public.portal_subscriptions s
              where s.customer_id = p_customer_id and s.status in ('active', 'past_due')
                and (s.current_period_end is null or s.current_period_end > now() - interval '2 days')), 0),
    coalesce((select coalesce(st.trial_level, 1)
              from public.portal_customers c
              left join public.portal_settings st on st.website_id = c.website_id
              where c.id = p_customer_id and c.trial_ends_at > now()), 0)
  )::smallint;
$$;
revoke all on function private.portal_customer_level(uuid) from public, anon, authenticated;

-- An information is visible only while the membership runs.
create or replace function private.portal_item_visible(p_item public.portal_items, p_customer_id uuid, p_offers text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_item.status = 'published'
    and (p_item.audience = 'all'
      or (p_item.audience = 'customer' and p_item.customer_id = p_customer_id)
      or (p_item.audience = 'offer' and p_item.offer_id = any (p_offers)))
    and (p_item.min_level = 0 or p_item.min_level <= private.portal_customer_level(p_customer_id))
    and private.portal_member_active(p_customer_id);
$$;

-- The member's monthly plan now (or the last one), for the space and the dashboard.
create or replace function private.portal_plan_json(p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('plan_name', p.plan_name, 'level', p.level, 'starts_at', p.starts_at,
                            'ends_at', p.ends_at, 'active', p.starts_at <= now() and p.ends_at > now(),
                            'amount', p.amount, 'currency', p.currency)
  from public.portal_periods p
  where p.customer_id = p_customer_id and p.kind = 'plan' and p.canceled_at is null
  order by (p.starts_at <= now() and p.ends_at > now()) desc, p.level desc, p.ends_at desc
  limit 1;
$$;
revoke all on function private.portal_plan_json(uuid) from public, anon, authenticated;

-- The membership as the space and the dashboard show it.
create or replace function private.portal_membership_json(p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'monthly', coalesce(st.membership_monthly, false),
    'until', c.member_until,
    'active', private.portal_member_active(c.id),
    'reminders', not c.reminders_off,
    'period_days', coalesce(st.period_days, 30),
    -- The offer renewed by default: the last one paid, else the one invited to.
    'offer_id', coalesce((select p.offer_id from public.site_payments p
                          where p.website_id = c.website_id and p.status = 'paid' and p.offer_id is not null
                            and p.offer_id not like 'plan-%'
                            and lower(p.customer_email) = any (c.payment_emails || c.email)
                          order by p.paid_at desc nulls last limit 1), c.offer_id))
  from public.portal_customers c
  left join public.portal_settings st on st.website_id = c.website_id
  where c.id = p_customer_id;
$$;
revoke all on function private.portal_membership_json(uuid) from public, anon, authenticated;

-- Adds one period after a paid month (idempotent per payment).
create or replace function private.portal_add_period(
  p_customer public.portal_customers, p_kind text, p_plan public.portal_plans, p_payment public.site_payments)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer; v_start timestamptz; v_end timestamptz; v_paid timestamptz := coalesce(p_payment.paid_at, now());
begin
  if p_payment.id is not null and exists (select 1 from public.portal_periods where payment_id = p_payment.id) then
    return;
  end if;
  select coalesce(st.period_days, 30) into v_days from public.portal_settings st where st.website_id = p_customer.website_id;
  v_days := coalesce(v_days, 30);
  if p_kind = 'membership' then
    -- Renewing early adds the month after the current end; after a gap it starts now.
    v_start := greatest(v_paid, coalesce(p_customer.member_until, v_paid));
  else
    v_start := greatest(v_paid, coalesce((select max(p.ends_at) from public.portal_periods p
                                          where p.customer_id = p_customer.id and p.kind = 'plan'
                                            and p.plan_id = p_plan.id and p.canceled_at is null), v_paid));
  end if;
  v_end := v_start + make_interval(days => v_days);
  insert into public.portal_periods (website_id, organization_id, customer_id, kind, plan_id, plan_name, level,
                                     payment_id, amount, currency, starts_at, ends_at)
  values (p_customer.website_id, p_customer.organization_id, p_customer.id, p_kind, p_plan.id, p_plan.name,
          coalesce(p_plan.level, 0), p_payment.id, p_payment.amount, p_payment.currency, v_start, v_end)
  on conflict (payment_id) do nothing;
  if p_kind = 'membership' then
    update public.portal_customers set member_until = greatest(coalesce(member_until, v_end), v_end), updated_at = now()
     where id = p_customer.id;
  end if;
  perform private.site_audit(p_customer.website_id, p_customer.organization_id,
    case when p_kind = 'membership' then 'portal.membership_paid' else 'portal.plan_paid' end,
    p_customer.id::text, jsonb_build_object('until', v_end, 'label', p_plan.name));
end;
$$;
revoke all on function private.portal_add_period(public.portal_customers, text, public.portal_plans, public.site_payments) from public, anon, authenticated;

-- ------------------------------------------------------------ payments -> members

-- A paid payment of a portal website: creates the member if new, then adds the
-- month it pays for (membership, or a plan when the site's server marked the
-- payment kind 'portal_plan'). The member is the one the site's server named
-- (metadata.portal_customer_id, for renewals from the space), else the payer's
-- e-mail. A refund shortens the period it paid for.
create or replace function private.portal_customer_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text; v_id uuid; c public.portal_customers; p public.portal_plans; v_monthly boolean;
begin
  if not private.portal_enabled(new.website_id) then
    return new;
  end if;

  -- Refund: the month it paid for ends now (or never starts).
  if new.status = 'refunded' and tg_op = 'UPDATE' and old.status = 'paid' then
    update public.portal_periods
       set canceled_at = now(), ends_at = greatest(starts_at, least(ends_at, now()))
     where payment_id = new.id and canceled_at is null
     returning customer_id into v_id;
    if v_id is not null then
      update public.portal_customers pc
         set member_until = (select max(x.ends_at) from public.portal_periods x
                             where x.customer_id = v_id and x.kind in ('membership', 'manual')), updated_at = now()
       where pc.id = v_id and exists (select 1 from public.portal_periods x where x.customer_id = v_id and x.kind = 'membership');
    end if;
    return new;
  end if;

  if new.status <> 'paid' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'paid' then
    return new;
  end if;

  if coalesce(new.metadata ->> 'portal_customer_id', '') ~ '^[0-9a-f-]{36}$' then
    select * into c from public.portal_customers
    where id = (new.metadata ->> 'portal_customer_id')::uuid and website_id = new.website_id and status = 'active';
  end if;

  if c.id is null then
    if new.customer_email is null then
      return new;
    end if;
    v_email := lower(btrim(new.customer_email));
    if not private.is_valid_email(v_email) then
      return new;
    end if;
    select * into c from public.portal_customers
    where website_id = new.website_id and status <> 'deleted' and (email = v_email or v_email = any (payment_emails))
    order by (status = 'active') desc limit 1;
    if c.id is null then
      insert into public.portal_customers (website_id, organization_id, email, payment_emails, name, locale, source)
      values (new.website_id, new.organization_id, v_email, array[v_email],
              left(private.clean_line(new.customer_name, 200), 120),
              case when new.metadata ->> 'lang' = 'fr' then 'fr' else 'en' end, 'payment')
      on conflict (website_id, email) do nothing
      returning * into c;
      if c.id is not null then
        insert into private.portal_outbox (website_id, customer_id, kind) values (new.website_id, c.id, 'access');
      else
        select * into c from public.portal_customers where website_id = new.website_id and email = v_email;
      end if;
    end if;
  end if;
  if c.id is null or c.status <> 'active' then
    return new;
  end if;

  if new.metadata ->> 'kind' = 'portal_plan' then
    if coalesce(new.metadata ->> 'plan_id', '') ~ '^[0-9a-f-]{36}$' then
      select * into p from public.portal_plans
      where id = (new.metadata ->> 'plan_id')::uuid and website_id = new.website_id;
    end if;
    if p.id is not null then
      perform private.portal_add_period(c, 'plan', p, new);
    end if;
    return new;
  end if;

  select coalesce(st.membership_monthly, false) into v_monthly from public.portal_settings st where st.website_id = new.website_id;
  if coalesce(v_monthly, false) and new.offer_id is not null then
    perform private.portal_add_period(c, 'membership', p, new);
  end if;
  return new;
end;
$$;
revoke all on function private.portal_customer_from_payment() from public, anon, authenticated;

drop trigger if exists site_payments_portal_customer on public.site_payments;
create trigger site_payments_portal_customer
  after insert or update of status on public.site_payments
  for each row execute function private.portal_customer_from_payment();

-- ------------------------------------------------------------ member: home

create or replace function public.portal_home(p_key text, p_session text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; v_offers text[]; v jsonb; v_level smallint; st public.portal_settings; v_active boolean;
begin
  c := private.portal_session(p_key, p_session);
  v_offers := private.portal_customer_offers(c.id);
  v_level := private.portal_customer_level(c.id);
  v_active := private.portal_member_active(c.id);
  select * into st from public.portal_settings where website_id = c.website_id;
  select jsonb_build_object(
    'customer', jsonb_build_object(
      'name', c.name, 'email', c.email, 'locale', c.locale, 'since', c.created_at,
      'has_password', exists (select 1 from private.portal_passwords where customer_id = c.id),
      'sessions', (select count(*) from private.portal_sessions
                   where customer_id = c.id and revoked_at is null and expires_at > now())),
    'offers', to_jsonb(v_offers),
    'membership', private.portal_membership_json(c.id),
    'access', jsonb_build_object(
      'level', case when v_active then v_level else 0 end,
      'trial_ends_at', c.trial_ends_at,
      'trial_active', v_active and c.trial_ends_at is not null and c.trial_ends_at > now(),
      'trial_days', coalesce(st.trial_days, 3),
      'plan', private.portal_plan_json(c.id),
      'subscription', private.portal_subscription_json(c.id)),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object('level', p.level, 'name', p.name, 'description', p.description,
                                          'features', p.features, 'amount', p.amount, 'currency', p.currency)
                       order by p.level)
      from public.portal_plans p where p.website_id = c.website_id and p.active), '[]'::jsonb),
    -- Contact details are for members only: they are never on the public site.
    'contact', case when v_active then coalesce(st.contact, '{}'::jsonb) else '{}'::jsonb end,
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'offer_id', p.offer_id, 'offer_name', p.offer_name, 'status', p.status,
        'amount', p.amount, 'currency', p.currency, 'paid_at', p.paid_at,
        'refunded_at', p.refunded_at, 'occurred_at', p.occurred_at,
        'amount_refunded', case when p.metadata ->> 'amount_refunded' ~ '^[0-9]{1,12}$'
                                then (p.metadata ->> 'amount_refunded')::bigint end,
        'refund', case when p.metadata ->> 'refund' in ('full', 'partial') then p.metadata ->> 'refund' end,
        'kind', case when p.metadata ->> 'kind' = 'portal_plan' then 'plan' else 'membership' end,
        'period_end', (select x.ends_at from public.portal_periods x where x.payment_id = p.id),
        'receipt', p.provider = 'stripe' and p.provider_payment_intent is not null)
        order by coalesce(p.paid_at, p.occurred_at) desc)
      from public.site_payments p
      where p.website_id = c.website_id
        and (lower(p.customer_email) = any (c.payment_emails || c.email)
             or p.metadata ->> 'portal_customer_id' = c.id::text)
        and p.status in ('paid', 'refunded')), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'title', i.title, 'body', i.body, 'trip', i.trip,
        'checklist', i.checklist, 'published_at', i.published_at, 'min_level', i.min_level,
        'document', case when i.kind = 'document' then jsonb_build_object(
          'name', i.document_name, 'size', i.document_size, 'type', i.document_type) end,
        'read', s.read_at is not null,
        'checked', coalesce(to_jsonb(s.checked), '[]'::jsonb))
        order by i.published_at desc)
      from (select * from public.portal_items i0
            where v_active and i0.website_id = c.website_id and private.portal_item_visible(i0, c.id, v_offers)
            order by i0.published_at desc limit 200) i
      left join public.portal_item_states s on s.item_id = i.id and s.customer_id = c.id), '[]'::jsonb),
    -- Information the member's plan does not include: the title only.
    'locked', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'title', l.title,
                                          'published_at', l.published_at, 'min_level', l.min_level)
                       order by l.published_at desc)
      from (select i.id, i.kind, i.title, i.published_at, i.min_level
            from public.portal_items i
            where v_active and i.website_id = c.website_id and i.status = 'published' and i.min_level > v_level
              and (i.audience = 'all'
                or (i.audience = 'customer' and i.customer_id = c.id)
                or (i.audience = 'offer' and i.offer_id = any (v_offers)))
            order by i.published_at desc limit 20) l), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body,
                                          'created_at', m.created_at,
                                          'read', m.sender = 'customer' or m.read_at is not null,
                                          'seen', m.sender = 'customer' and m.read_at is not null)
                       order by m.created_at)
      from (select * from public.portal_messages where customer_id = c.id
            order by created_at desc limit 200) m), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.portal_home(text, text) from public;
grant execute on function public.portal_home(text, text) to anon, authenticated;

-- Sending messages needs a running membership.
do $do$
declare
  d text := pg_get_functiondef('public.portal_send_message(text,text,text)'::regprocedure);
  anchor text := $a$  c := private.portal_session(p_key, p_session);
  v_body := private.check_text(p_body, 4000, 'message', true);$a$;
begin
  if position('portal_member_active' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'portal_send_message: unexpected body, not patched';
  end if;
  execute replace(d, anchor, $ins$  c := private.portal_session(p_key, p_session);
  if not private.portal_member_active(c.id) then
    raise exception 'Membership expired' using errcode = 'PT402';
  end if;
  v_body := private.check_text(p_body, 4000, 'message', true);$ins$);
end;
$do$;

-- ------------------------------------------------------------ member: renew, plans, reminders

-- What the site's server needs to open the payment page of the next month.
create or replace function public.portal_renew_start(p_key text, p_session text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  perform private.hit_rate_limit('portal_renew', c.id::text, 10, interval '1 hour');
  return jsonb_build_object('customer_id', c.id, 'email', c.email, 'name', c.name, 'locale', c.locale,
                            'membership', private.portal_membership_json(c.id));
end;
$$;
revoke all on function public.portal_renew_start(text, text) from public;
grant execute on function public.portal_renew_start(text, text) to anon, authenticated;

-- Reminders on or off ("cancel" stops them; access runs until the date already paid).
create or replace function public.portal_set_reminders(p_key text, p_session text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  update public.portal_customers set reminders_off = not coalesce(p_on, true), updated_at = now() where id = c.id;
  perform private.site_audit(c.website_id, c.organization_id,
    case when coalesce(p_on, true) then 'portal.renewal_resumed' else 'portal.renewal_canceled' end, c.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'reminders', coalesce(p_on, true));
end;
$$;
revoke all on function public.portal_set_reminders(text, text, boolean) from public;
grant execute on function public.portal_set_reminders(text, text, boolean) to anon, authenticated;

-- Daily: queue the renewal reminders (7, 3 and 1 day before, and on the day it ends).
create or replace function private.portal_renewal_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record; v_new integer := 0; v_stage integer;
begin
  for r in
    select c.id, c.website_id, c.member_until as until, 'membership' as what, null::text as plan_name
    from public.portal_customers c
    join public.portal_settings st on st.website_id = c.website_id and st.membership_monthly
    where c.status = 'active' and not c.reminders_off
      and c.member_until between now() - interval '1 day' and now() + interval '7 days 1 hour'
    union all
    select c.id, c.website_id, p.ends_at, 'plan', p.plan_name
    from public.portal_customers c
    join lateral (select x.ends_at, x.plan_name from public.portal_periods x
                  where x.customer_id = c.id and x.kind = 'plan' and x.canceled_at is null
                  order by x.ends_at desc limit 1) p on true
    where c.status = 'active' and not c.reminders_off
      and p.ends_at between now() - interval '1 day' and now() + interval '7 days 1 hour'
  loop
    v_stage := case
      when r.until <= now() then 0
      when r.until <= now() + interval '1 day 1 hour' then 1
      when r.until <= now() + interval '3 days 1 hour' then 3
      else 7 end;
    if not exists (select 1 from private.portal_outbox o
                   where o.customer_id = r.id and o.kind = 'renew'
                     and o.data ->> 'what' = r.what and o.data ->> 'until' = r.until::text
                     and (o.data ->> 'stage')::integer <= v_stage) then
      insert into private.portal_outbox (website_id, customer_id, kind, data)
      values (r.website_id, r.id, 'renew',
              jsonb_build_object('what', r.what, 'until', r.until::text, 'stage', v_stage, 'plan', r.plan_name));
      v_new := v_new + 1;
    end if;
  end loop;
  return v_new;
end;
$$;
revoke all on function private.portal_renewal_reminders() from public, anon, authenticated;

-- Every day at 07:00 UTC, just before the website's daily e-mail run (07:23 UTC).
select cron.unschedule(jobid) from cron.job where jobname = 'portal-renewal-reminders';
select cron.schedule('portal-renewal-reminders', '0 7 * * *', $$select private.portal_renewal_reminders()$$);

-- ------------------------------------------------------------ owner (dashboard)

-- The owner can move the end of one member's membership (up to a year ahead, or end it now).
create or replace function public.portal_admin_set_member_until(p_customer_id uuid, p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; v_org uuid;
begin
  select * into c from public.portal_customers where id = p_customer_id and status <> 'deleted';
  if c.id is null then
    raise exception 'Unknown customer' using errcode = 'PT404';
  end if;
  v_org := private.portal_manage_site(c.website_id);
  if p_until is null or p_until > now() + interval '366 days' then
    raise exception 'Invalid date' using errcode = '22023';
  end if;
  insert into public.portal_periods (website_id, organization_id, customer_id, kind, starts_at, ends_at)
  values (c.website_id, c.organization_id, c.id, 'manual', least(now(), p_until), p_until);
  update public.portal_customers set member_until = p_until, updated_at = now() where id = c.id;
  perform private.site_audit(c.website_id, v_org, 'portal.membership_changed', c.id::text,
    jsonb_build_object('until', p_until));
end;
$$;
revoke all on function public.portal_admin_set_member_until(uuid, timestamptz) from public, anon;
grant execute on function public.portal_admin_set_member_until(uuid, timestamptz) to authenticated;

-- Overview: each member's membership and monthly plan.
do $do$
declare
  d text := pg_get_functiondef('public.portal_admin_overview(text)'::regprocedure);
  a1 text := $a$'trial_ends_at', c.trial_ends_at,$a$;
begin
  if position('portal_membership_json' in d) > 0 then
    return;
  end if;
  if position(a1 in d) = 0 then
    raise exception 'portal_admin_overview: unexpected body, not patched';
  end if;
  execute replace(d, a1, a1 || $ins$ 'membership', private.portal_membership_json(c.id),
        'plan', private.portal_plan_json(c.id),$ins$);
end;
$do$;

-- Settings: monthly membership and period length are shown to the owner.
do $do$
declare
  d text := pg_get_functiondef('public.portal_admin_settings(text)'::regprocedure);
  a1 text := $a$'trial_level', coalesce(st.trial_level, 1),$a$;
begin
  if position('membership_monthly' in d) > 0 then
    return;
  end if;
  if position(a1 in d) = 0 then
    raise exception 'portal_admin_settings: unexpected body, not patched';
  end if;
  d := replace(d, a1, a1 || $ins$
    'membership_monthly', coalesce(st.membership_monthly, false),
    'period_days', coalesce(st.period_days, 30),$ins$);
  -- Members on a plan now (monthly purchases).
  d := regexp_replace(d,
    '\(select count\(\*\) from public\.portal_subscriptions s\s+where s\.plan_id = p\.id and s\.status in \(''active'', ''past_due''\)\)',
    '(select count(distinct x.customer_id) from public.portal_periods x where x.plan_id = p.id and x.kind = ''plan'' and x.canceled_at is null and x.starts_at <= now() and x.ends_at > now())');
  if position('portal_periods' in d) = 0 then
    raise exception 'portal_admin_settings: subscriber count not patched';
  end if;
  execute d;
end;
$do$;
