-- Founding members (Black Pater first): everyone who joins before the end of
-- the launch countdown (portal_settings.founder_until) is a founding member for
-- good. They keep their formula's founder price and get the features of a plan
-- by formula: Solo -> Plus (1), Duo -> Pro (2), Famille -> Premium (3), plus a
-- "founding member" badge. After the countdown, new members pay the new prices.
-- Applied as migration portal_founders.
--
--   portal_customers.founder_level / founder_since
--   portal_settings.founder_until            end of the founder window (null: none)
--   private.portal_offer_level(offer)        formula -> plan level
--   portal_customer_level                    + the founder level while the membership runs
--   portal_membership_json                   + founder_level, founder_since
--   portal_customer_from_payment             a membership paid before founder_until makes a founder

alter table public.portal_customers
  add column if not exists founder_level smallint check (founder_level between 1 and 3),
  add column if not exists founder_since timestamptz;
alter table public.portal_settings add column if not exists founder_until timestamptz;

update public.portal_settings set founder_until = '2026-11-17T06:59:59Z'
 where website_id = 'ws_ab9493c5857ed460' and founder_until is null;

create or replace function private.portal_offer_level(p_offer text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_offer is null then null
    when p_offer ~ '-(famille|family)$' then 3
    when p_offer ~ '-duo$' then 2
    else 1
  end::smallint;
$$;
revoke all on function private.portal_offer_level(text) from public, anon, authenticated;

-- Members who paid a formula before the end of the window.
update public.portal_customers c
   set founder_level = x.level, founder_since = x.since
  from (
    select c2.id, max(private.portal_offer_level(p.offer_id)) as level, min(p.paid_at) as since
    from public.portal_customers c2
    join public.portal_settings st on st.website_id = c2.website_id and st.founder_until is not null
    join public.site_payments p on p.website_id = c2.website_id and p.status = 'paid'
      and p.offer_id is not null and p.offer_id not like 'plan-%'
      and lower(p.customer_email) = any (c2.payment_emails || c2.email)
      and coalesce(p.paid_at, p.created_at) < st.founder_until
    where c2.deleted_at is null
    group by c2.id
  ) x
 where c.id = x.id and c.founder_level is null;

do $$
declare d text;
begin
  -- Founder features while the membership runs.
  d := pg_get_functiondef('private.portal_customer_level(uuid)'::regprocedure);
  if position('  )::smallint;' in d) = 0 then
    raise exception 'portal_customer_level: anchor not found';
  end if;
  d := replace(d, '  )::smallint;', ',
    coalesce((select c.founder_level from public.portal_customers c
              where c.id = p_customer_id and c.founder_level is not null
                and private.portal_member_active(c.id)), 0)
  )::smallint;');
  execute d;

  -- Shown in the member space (badge, features).
  d := pg_get_functiondef('private.portal_membership_json(uuid)'::regprocedure);
  if position('''reminders'', not c.reminders_off,' in d) = 0 then
    raise exception 'portal_membership_json: anchor not found';
  end if;
  d := replace(d, '''reminders'', not c.reminders_off,', '''reminders'', not c.reminders_off,
    ''founder_level'', c.founder_level, ''founder_since'', c.founder_since,');
  execute d;

  -- A formula paid before the end of the window makes a founding member.
  d := pg_get_functiondef('private.portal_customer_from_payment()'::regprocedure);
  if position('    perform private.portal_add_period(c, ''membership'', p, new);
  end if;
  return new;' in d) = 0 then
    raise exception 'portal_customer_from_payment: anchor not found';
  end if;
  d := replace(d, '    perform private.portal_add_period(c, ''membership'', p, new);
  end if;
  return new;', '    perform private.portal_add_period(c, ''membership'', p, new);
  end if;
  if new.offer_id is not null and new.offer_id not like ''plan-%'' and exists (
       select 1 from public.portal_settings st
       where st.website_id = new.website_id and st.founder_until is not null
         and coalesce(new.paid_at, new.created_at, now()) < st.founder_until) then
    update public.portal_customers
       set founder_level = greatest(coalesce(founder_level, 0), private.portal_offer_level(new.offer_id)),
           founder_since = coalesce(founder_since, coalesce(new.paid_at, now())), updated_at = now()
     where id = c.id;
  end if;
  return new;');
  execute d;
end $$;
