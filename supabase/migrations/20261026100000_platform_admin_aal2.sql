-- Platform admin powers need an aal2 session (tenant isolation audit, 2026-10-26).
--
-- Hole: private.is_platform_admin() only checked public.platform_admins. Every
-- tenant RLS policy ("... OR private.is_platform_admin()") and has_org_role()
-- (admin rights in every organization) trusted it, so a stolen staff password
-- on an aal1 session (second factor not entered) could read and edit every
-- client's data through the Data API: submissions, appointments, payments,
-- members, media. Only the admin RPCs (assert_platform_admin -> assert_mfa)
-- asked for the second factor, and only when a factor was enrolled.
--
-- Fix: platform admin = row in platform_admins AND the JWT says aal2. A staff
-- account without an authenticator app has no platform powers until it
-- enrolls one (LevelUp HQ already works this way). Signed-in staff with a
-- verified factor are always sent through /auth/mfa, so their sessions are
-- aal2 and nothing changes for them.
--
-- assert_platform_admin keeps its "MFA required ... (aal2)" message for staff
-- on aal1, so the dashboard still shows the "Verify now" step instead of a
-- plain "forbidden". ai_usage_summary used its own platform_admins check.
--
-- Also drops grants that RLS already made useless (defense in depth):
-- ai_usage (written by SECURITY DEFINER functions only), anon SELECT and
-- authenticated INSERT / UPDATE on organization_invitations (writes go through
-- the invitation RPCs; no permissive INSERT / UPDATE policy exists).

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    and exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

create or replace function private.assert_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not exists (select 1 from public.platform_admins where user_id = (select auth.uid())) then
    raise exception 'Forbidden' using errcode = 'PT403';
  end if;
  if coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then
    raise exception 'MFA required: verify your second factor (aal2)' using errcode = 'PT403';
  end if;
end;
$$;

create or replace function public.ai_usage_summary(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.calls desc)
    from (
      select app, provider, model, count(*)::int as calls
      from public.ai_calls
      where created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 90)))
      group by app, provider, model
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke select on public.ai_usage from anon, authenticated;
revoke select on public.organization_invitations from anon;
revoke insert, update on public.organization_invitations from authenticated;
