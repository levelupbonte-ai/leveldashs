-- A monthly plan replaces the base membership for its month (one payment,
-- not base + plan). Buying a plan: the plan starts now (or after the same plan
-- already running); the base days not used yet are moved after it, and so are
-- the remaining days of another plan. The membership runs to the end.
-- Applied as migrations portal_plan_replaces_base and portal_founder_periods.

create or replace function private.portal_add_period(
  p_customer public.portal_customers, p_kind text, p_plan public.portal_plans, p_payment public.site_payments)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer; v_start timestamptz; v_end timestamptz; v_paid timestamptz := coalesce(p_payment.paid_at, now());
  v_plan_end timestamptz; v_base_left interval := interval '0'; v_member_until timestamptz;
begin
  if p_payment.id is not null and exists (select 1 from public.portal_periods where payment_id = p_payment.id) then
    return;
  end if;
  select coalesce(st.period_days, 30) into v_days from public.portal_settings st where st.website_id = p_customer.website_id;
  v_days := coalesce(v_days, 30);

  if p_kind = 'membership' then
    -- After every plan or month already paid: renewing early loses no day.
    v_start := greatest(v_paid, coalesce(p_customer.member_until, v_paid));
    v_end := v_start + make_interval(days => v_days);
  else
    -- Latest end of any running plan, and the base days left after it.
    select max(p.ends_at) into v_plan_end from public.portal_periods p
    where p.customer_id = p_customer.id and p.kind = 'plan' and p.canceled_at is null and p.ends_at > v_paid;
    if p_customer.member_until is not null and p_customer.member_until > greatest(v_paid, coalesce(v_plan_end, v_paid)) then
      v_base_left := p_customer.member_until - greatest(v_paid, coalesce(v_plan_end, v_paid));
    end if;
    -- Same plan running: the new month follows it. Another plan: it starts now.
    v_start := greatest(v_paid, coalesce((select max(p.ends_at) from public.portal_periods p
                                          where p.customer_id = p_customer.id and p.kind = 'plan'
                                            and p.plan_id = p_plan.id and p.canceled_at is null), v_paid));
    v_end := v_start + make_interval(days => v_days);
    -- The days left on another running plan move after the new one.
    update public.portal_periods p
       set starts_at = v_end, ends_at = v_end + (p.ends_at - greatest(p.starts_at, v_paid))
     where p.customer_id = p_customer.id and p.kind = 'plan' and p.canceled_at is null
       and p.plan_id is distinct from p_plan.id and p.ends_at > v_paid;
  end if;

  insert into public.portal_periods (website_id, organization_id, customer_id, kind, plan_id, plan_name, level,
                                     payment_id, amount, currency, starts_at, ends_at)
  values (p_customer.website_id, p_customer.organization_id, p_customer.id, p_kind, p_plan.id, p_plan.name,
          coalesce(p_plan.level, 0), p_payment.id, p_payment.amount, p_payment.currency, v_start, v_end)
  on conflict (payment_id) do nothing;

  if p_kind = 'membership' then
    v_member_until := greatest(coalesce(p_customer.member_until, v_end), v_end);
  else
    -- Membership covers every plan month, then the base days left.
    select max(p.ends_at) into v_plan_end from public.portal_periods p
    where p.customer_id = p_customer.id and p.kind = 'plan' and p.canceled_at is null;
    v_member_until := greatest(coalesce(v_plan_end, v_end), v_end) + v_base_left;
  end if;
  update public.portal_customers set member_until = v_member_until, updated_at = now() where id = p_customer.id;

  perform private.site_audit(p_customer.website_id, p_customer.organization_id,
    case when p_kind = 'membership' then 'portal.membership_paid' else 'portal.plan_paid' end,
    p_customer.id::text, jsonb_build_object('until', v_end, 'label', p_plan.name));
end;
$$;
revoke all on function private.portal_add_period(public.portal_customers, text, public.portal_plans, public.site_payments) from public, anon, authenticated;

-- Refund of a plan month also shortens the membership it covered.
do $do$
declare
  d text := pg_get_functiondef('private.portal_customer_from_payment()'::regprocedure);
  a1 text := $a$where x.customer_id = v_id and x.kind in ('membership', 'manual')), updated_at = now()$a$;
  a2 text := $a$where pc.id = v_id and exists (select 1 from public.portal_periods x where x.customer_id = v_id and x.kind = 'membership');$a$;
begin
  if position($a$x.kind in ('membership', 'manual', 'plan')$a$ in d) > 0 then
    return;
  end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 then
    raise exception 'portal_customer_from_payment: unexpected body, not patched';
  end if;
  d := replace(d, a1, $a$where x.customer_id = v_id and x.kind in ('membership', 'manual', 'plan') and x.canceled_at is null), updated_at = now()$a$);
  d := replace(d, a2, $a$where pc.id = v_id;$a$);
  execute d;
end;
$do$;

-- Members whose end date was set directly (founders) get a matching period, so
-- recomputing the end date after a refund never drops their days.
insert into public.portal_periods (website_id, organization_id, customer_id, kind, starts_at, ends_at)
select c.website_id, c.organization_id, c.id, 'manual', least(now(), c.member_until), c.member_until
from public.portal_customers c
where c.member_until is not null and c.status = 'active'
  and not exists (select 1 from public.portal_periods p where p.customer_id = c.id);
