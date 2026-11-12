-- A member can switch between the monthly plans: the provider keeps the same
-- subscription and the site's server reports the new plan (from the
-- subscription metadata it set itself). portal_subscription_sync now applies
-- it to a known subscription.

create or replace function public.portal_subscription_sync(p_key text, p_sub jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text; v_org uuid; v_sid text; v_customer uuid; v_plan uuid; v_status text;
  c public.portal_customers; p public.portal_plans; v_end timestamptz;
begin
  select website_id, organization_id into v_site, v_org from private.portal_key_website(p_key);
  if p_sub is null or jsonb_typeof(p_sub) <> 'object' then
    raise exception 'Invalid subscription' using errcode = '22023';
  end if;
  v_sid := p_sub ->> 'subscription_id';
  if v_sid is null or v_sid !~ '^sub_[A-Za-z0-9]{5,100}$' then
    raise exception 'Invalid subscription' using errcode = '22023';
  end if;
  v_status := case p_sub ->> 'status'
    when 'active' then 'active' when 'trialing' then 'active'
    when 'past_due' then 'past_due' when 'unpaid' then 'past_due'
    when 'canceled' then 'canceled' when 'incomplete_expired' then 'canceled'
    when 'incomplete' then 'incomplete' when 'paused' then 'canceled'
    else null end;
  if v_status is null then
    raise exception 'Invalid subscription status' using errcode = '22023';
  end if;
  if (p_sub ->> 'current_period_end') ~ '^[0-9]{9,11}$' then
    v_end := to_timestamp((p_sub ->> 'current_period_end')::bigint);
  end if;

  -- Plan named by the site's server (set in the provider's metadata): must be one of this website's plans.
  if coalesce(p_sub ->> 'plan_id', '') ~ '^[0-9a-f-]{36}$' then
    select * into p from public.portal_plans where id = (p_sub ->> 'plan_id')::uuid and website_id = v_site;
  end if;

  -- Known subscription: its state changes, and its plan when the member switched plans.
  update public.portal_subscriptions s
     set plan_id = coalesce(p.id, s.plan_id),
         plan_name = coalesce(p.name, s.plan_name),
         level = coalesce(p.level, s.level),
         amount = case when p.id is not null and p.id <> s.plan_id then p.amount else s.amount end,
         currency = case when p.id is not null and p.id <> s.plan_id then p.currency else s.currency end
   where s.provider = 'stripe' and s.provider_subscription_id = v_sid and s.website_id = v_site
     and p.id is not null and p.id <> s.plan_id;
  update public.portal_subscriptions s
     set status = v_status,
         current_period_end = coalesce(v_end, s.current_period_end),
         cancel_at_period_end = coalesce((p_sub ->> 'cancel_at_period_end')::boolean, false),
         canceled_at = case when v_status = 'canceled' then coalesce(s.canceled_at, now()) else null end,
         provider_customer_id = coalesce(left(p_sub ->> 'provider_customer_id', 120), s.provider_customer_id),
         updated_at = now()
   where s.provider = 'stripe' and s.provider_subscription_id = v_sid and s.website_id = v_site;
  if found then
    return jsonb_build_object('ok', true, 'created', false);
  end if;

  if coalesce(p_sub ->> 'customer_id', '') !~ '^[0-9a-f-]{36}$' or coalesce(p_sub ->> 'plan_id', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'Unknown subscription' using errcode = 'PT404';
  end if;
  v_customer := (p_sub ->> 'customer_id')::uuid;
  v_plan := (p_sub ->> 'plan_id')::uuid;
  select * into c from public.portal_customers where id = v_customer and website_id = v_site;
  if c.id is null or p.id is null then
    raise exception 'Unknown subscription' using errcode = 'PT404';
  end if;
  insert into public.portal_subscriptions (website_id, organization_id, customer_id, plan_id, plan_name, level,
                                           amount, currency, provider_subscription_id, provider_customer_id,
                                           status, current_period_end, cancel_at_period_end, canceled_at)
  values (v_site, v_org, c.id, p.id, p.name, p.level, p.amount, p.currency, v_sid,
          left(p_sub ->> 'provider_customer_id', 120), v_status, v_end,
          coalesce((p_sub ->> 'cancel_at_period_end')::boolean, false),
          case when v_status = 'canceled' then now() end)
  on conflict (provider, provider_subscription_id) do nothing;
  perform private.site_audit(v_site, v_org, 'portal.subscription_started', c.id::text,
    jsonb_build_object('label', p.name, 'level', p.level));
  return jsonb_build_object('ok', true, 'created', true);
end;
$$;
revoke all on function public.portal_subscription_sync(text, jsonb) from public;
grant execute on function public.portal_subscription_sync(text, jsonb) to anon, authenticated;
