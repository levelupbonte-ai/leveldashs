-- Whether the signed-in user is LevelUp staff (listed in platform_admins). Used by
-- the client Billing page to show staff why online payment is off (variable
-- names only); grants nothing by itself, unlike private.is_platform_admin (aal2).
create or replace function public.billing_viewer_is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

revoke all on function public.billing_viewer_is_staff() from public, anon;
grant execute on function public.billing_viewer_is_staff() to authenticated;
