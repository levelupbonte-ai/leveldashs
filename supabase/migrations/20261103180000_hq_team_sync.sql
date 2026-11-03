-- HQ team: platform admin rights always follow the HQ role, the last active
-- owner can never be removed, and HQ can set a client's country (clients map).

-- Owner / admin (active) = platform admin; any other role or inactive = not.
create or replace function private.hq_staff_sync_platform_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active and new.role in ('owner', 'admin') then
    insert into public.platform_admins (user_id) values (new.user_id) on conflict (user_id) do nothing;
  else
    delete from public.platform_admins where user_id = new.user_id;
  end if;
  return new;
end;
$$;
drop trigger if exists hq_staff_sync_platform_admin on public.hq_staff;
create trigger hq_staff_sync_platform_admin
  after insert or update of role, active on public.hq_staff
  for each row execute function private.hq_staff_sync_platform_admin();

-- Never leave HQ without an active owner.
create or replace function private.hq_staff_keep_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and old.active and (new.role <> 'owner' or not new.active)
     and not exists (
       select 1 from public.hq_staff s
       where s.user_id <> old.user_id and s.role = 'owner' and s.active
     ) then
    raise exception 'last_owner' using errcode = 'PT409';
  end if;
  return new;
end;
$$;
drop trigger if exists hq_staff_keep_owner on public.hq_staff;
create trigger hq_staff_keep_owner
  before update of role, active on public.hq_staff
  for each row execute function private.hq_staff_keep_owner();

-- HQ: where a client is based (two-letter country, or null to clear).
create or replace function public.hq_set_client_country(p_org uuid, p_country text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_country text := nullif(upper(btrim(coalesce(p_country, ''))), '');
begin
  perform private.hq_assert('clients.write');
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'invalid country' using errcode = '22023';
  end if;
  update public.organizations set country = v_country where id = p_org;
  if not found then
    raise exception 'Unknown client' using errcode = 'PT404';
  end if;
  perform private.hq_log('client.country', 'organization', p_org::text, jsonb_build_object('country', v_country));
  return v_country;
end;
$$;
revoke all on function public.hq_set_client_country(uuid, text) from public, anon;
grant execute on function public.hq_set_client_country(uuid, text) to authenticated;
