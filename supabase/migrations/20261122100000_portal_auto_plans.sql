-- Black Pater: three monthly plans paid automatically (Stripe subscriptions),
-- the same price for everyone: Plus 11, Pro 16, Premium 23 USD (1 plan = 1
-- dossier). Members who paid the launch membership move over with a credit:
-- what they paid and did not use yet is deducted from their first month.
-- Applied as migration portal_auto_plans.
--
--   private.portal_transition_credit(customer)   cents not used yet (0 with a running plan)
--   portal_subscribe_start                       + 'credit'
--   portal_membership_json                       + 'credit'
--   portal_subscription_sync                     a running plan sets member_until (period end + 1 day);
--                                                the first one closes the old paid periods (now in the credit)
--   portal_renewal_reminders                     no "renew" e-mails while a plan renews by itself

-- 1. The plans (owner can rename or reprice them in the dashboard).
insert into public.portal_plans (website_id, organization_id, level, name, description, features, amount, currency, active)
select w.id, w.organization_id, v.level, v.name, v.description, v.features, v.amount, 'usd', true
from public.websites w
cross join (values
  (1, 'Plus', 'L’accompagnement essentiel',
   '["1 appel vocal de 20 min par mois", "Réponse de l’équipe sous 72 h"]'::jsonb, 1100),
  (2, 'Pro', 'L’accompagnement complet',
   '["3 appels vocaux de 20 min par mois", "Alertes urgentes en notification", "Réponse de l’équipe sous 48 h"]'::jsonb, 1600),
  (3, 'Premium', 'Le suivi prioritaire',
   '["5 appels par mois, vocal ou vidéo (Zoom, Google Meet ou WhatsApp, au choix)", "Réunions Premium sur Zoom avec l’équipe", "Alertes urgentes en premier", "Vérification complète du dossier", "Réponse prioritaire sous 24 h"]'::jsonb, 2300)
) as v(level, name, description, features, amount)
where w.id = 'ws_ab9493c5857ed460'
  and not exists (select 1 from public.portal_plans p where p.website_id = w.id and p.level = v.level);

-- 2. Credit of the time already paid and not used yet (launch membership or plan months).
create or replace function private.portal_transition_credit(p_customer_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.portal_subscriptions s
                 where s.customer_id = p_customer_id and s.status in ('active', 'past_due')) then 0
    else least(5000, coalesce((
      select sum(round(p.amount * extract(epoch from (p.ends_at - greatest(p.starts_at, now())))
                       / nullif(extract(epoch from (p.ends_at - p.starts_at)), 0)))::integer
      from public.portal_periods p
      where p.customer_id = p_customer_id and p.kind in ('membership', 'plan') and p.canceled_at is null
        and p.amount is not null and p.amount > 0 and p.ends_at > now()), 0))
  end;
$$;
revoke all on function private.portal_transition_credit(uuid) from public, anon, authenticated;

-- 3. What a running plan changes: access follows the plan; the first plan closes the old paid time.
create or replace function private.portal_subscription_effects(p_site text, p_sid text, p_created boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.portal_subscriptions;
begin
  select * into s from public.portal_subscriptions
  where provider = 'stripe' and provider_subscription_id = p_sid and website_id = p_site;
  if s.id is null or s.status not in ('active', 'past_due') then
    return;
  end if;
  if p_created and s.status = 'active' then
    -- The paid time not used yet became the credit of the first month.
    update public.portal_periods set canceled_at = now()
     where customer_id = s.customer_id and kind in ('membership', 'plan') and canceled_at is null and starts_at > now();
    update public.portal_periods set ends_at = now()
     where customer_id = s.customer_id and kind in ('membership', 'plan') and canceled_at is null
       and starts_at <= now() and ends_at > now();
    update public.portal_customers set member_until = s.current_period_end + interval '1 day', updated_at = now()
     where id = s.customer_id and s.current_period_end is not null;
  elsif s.current_period_end is not null then
    update public.portal_customers
       set member_until = greatest(coalesce(member_until, s.current_period_end + interval '1 day'), s.current_period_end + interval '1 day'),
           updated_at = now()
     where id = s.customer_id;
  end if;
end;
$$;
revoke all on function private.portal_subscription_effects(text, text, boolean) from public, anon, authenticated;

do $$
declare d text;
begin
  -- portal_subscription_sync applies the effects on every change.
  d := pg_get_functiondef('public.portal_subscription_sync(text,jsonb)'::regprocedure);
  if position('  if found then
    return jsonb_build_object(''ok'', true, ''created'', false);' in d) = 0
     or position('  return jsonb_build_object(''ok'', true, ''created'', true);' in d) = 0 then
    raise exception 'portal_subscription_sync: anchor not found';
  end if;
  d := replace(d, '  if found then
    return jsonb_build_object(''ok'', true, ''created'', false);',
    '  if found then
    perform private.portal_subscription_effects(v_site, v_sid, false);
    return jsonb_build_object(''ok'', true, ''created'', false);');
  d := replace(d, '  return jsonb_build_object(''ok'', true, ''created'', true);',
    '  perform private.portal_subscription_effects(v_site, v_sid, true);
  return jsonb_build_object(''ok'', true, ''created'', true);');
  execute d;

  -- The credit, shown in the space and applied by the payment page.
  d := pg_get_functiondef('public.portal_subscribe_start(text,text,integer)'::regprocedure);
  if position('''provider_customer_id'', (select' in d) = 0 then
    raise exception 'portal_subscribe_start: anchor not found';
  end if;
  d := replace(d, '''provider_customer_id'', (select', '''credit'', private.portal_transition_credit(c.id),
    ''provider_customer_id'', (select');
  execute d;

  d := pg_get_functiondef('private.portal_membership_json(uuid)'::regprocedure);
  if position('''reminders'', not c.reminders_off,' in d) = 0 then
    raise exception 'portal_membership_json: anchor not found';
  end if;
  d := replace(d, '''reminders'', not c.reminders_off,', '''reminders'', not c.reminders_off,
    ''credit'', private.portal_transition_credit(c.id),');
  execute d;

  -- No "renew" reminder while a plan renews by itself.
  d := pg_get_functiondef('private.portal_renewal_reminders()'::regprocedure);
  if position('      and c.member_until between now() - interval ''1 day'' and now() + interval ''7 days 1 hour''' in d) = 0 then
    raise exception 'portal_renewal_reminders: anchor not found';
  end if;
  d := replace(d, '      and c.member_until between now() - interval ''1 day'' and now() + interval ''7 days 1 hour''',
    '      and c.member_until between now() - interval ''1 day'' and now() + interval ''7 days 1 hour''
      and not exists (select 1 from public.portal_subscriptions s
                      where s.customer_id = c.id and s.status in (''active'', ''past_due'') and not s.cancel_at_period_end)');
  execute d;
end $$;
