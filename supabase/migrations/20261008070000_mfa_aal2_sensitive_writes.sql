-- MFA (TOTP) hardening: sensitive writes need an aal2 session once the user has
-- a verified MFA factor (Supabase-recommended pattern). Users without a verified
-- factor keep working exactly as before.
--
-- Covered:
--   * organization_members insert / update / delete (team roles, removals)
--   * organization_invitations insert / update / delete (pending invitations)
--   * add_organization_member RPC (add / re-role by e-mail, creates invitations)
--   * platform-admin RPCs (admin_create_client_site, admin_update_website) through
--     private.assert_platform_admin()

-- True when the current JWT is aal2, or when the user has no verified factor.
-- SECURITY DEFINER: authenticated cannot read auth.mfa_factors directly.
create or replace function private.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    or not exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = (select auth.uid())
        and f.status = 'verified'
    );
$$;

revoke all on function private.mfa_satisfied() from public;
grant execute on function private.mfa_satisfied() to authenticated;

create or replace function private.assert_mfa()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.mfa_satisfied() then
    raise exception 'MFA required: verify your second factor (aal2)' using errcode = 'PT403';
  end if;
end;
$$;

revoke all on function private.assert_mfa() from public;
grant execute on function private.assert_mfa() to authenticated;

-- RESTRICTIVE policies: AND-ed with the existing permissive ones (never widen access).
do $$
declare
  t text;
  c text;
begin
  foreach t in array array['organization_members', 'organization_invitations'] loop
    foreach c in array array['insert', 'update', 'delete'] loop
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t and policyname = t || '_' || c || '_require_aal2'
      ) then
        if c = 'insert' then
          execute format(
            'create policy %I on public.%I as restrictive for insert to authenticated with check ((select private.mfa_satisfied()))',
            t || '_' || c || '_require_aal2', t);
        elsif c = 'update' then
          execute format(
            'create policy %I on public.%I as restrictive for update to authenticated using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()))',
            t || '_' || c || '_require_aal2', t);
        else
          execute format(
            'create policy %I on public.%I as restrictive for delete to authenticated using ((select private.mfa_satisfied()))',
            t || '_' || c || '_require_aal2', t);
        end if;
      end if;
    end loop;
  end loop;
end;
$$;

-- Platform-admin RPCs: same check, right after the admin check.
create or replace function private.assert_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'Forbidden' using errcode = 'PT403';
  end if;
  perform private.assert_mfa();
end;
$$;

-- SECURITY DEFINER RPC bypasses RLS, so it checks aal2 itself.
create or replace function public.add_organization_member(p_organization_id uuid, p_email text, p_role text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_role not in ('owner', 'admin', 'editor', 'viewer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  if not private.has_org_role(p_organization_id, case when p_role = 'owner' then 'owner' else 'admin' end) then
    raise exception 'Forbidden' using errcode = 'PT403';
  end if;
  perform private.assert_mfa();

  select m.role into v_existing
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_organization_id and lower(u.email) = lower(btrim(p_email));
  if v_existing = 'owner' and not private.has_org_role(p_organization_id, 'owner') then
    raise exception 'Forbidden' using errcode = 'PT403';
  end if;

  return private.invite_member(p_organization_id, p_email, p_role);
end;
$$;
