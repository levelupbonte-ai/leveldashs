-- Acceptance of the LevelUp legal documents (Terms of Service, Acceptable Use
-- Policy, Privacy Policy) at sign-up. One row per account and document version,
-- timestamped by the database. Users read their own rows; LevelUp staff read all;
-- nobody updates or deletes through the API (rows go with the account).

create table if not exists public.legal_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  version text not null check (version ~ '^\d{4}-\d{2}-\d{2}$'),
  documents text[] not null default array['terms', 'acceptable-use', 'privacy'],
  source text not null check (source in ('signup', 'google', 'onboarding')),
  accepted_at timestamptz not null default now(),
  unique (user_id, version)
);

create index if not exists legal_acceptances_user_idx on public.legal_acceptances (user_id);

alter table public.legal_acceptances enable row level security;

revoke all on public.legal_acceptances from anon, authenticated;
grant select on public.legal_acceptances to authenticated;

create policy legal_acceptances_select on public.legal_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_platform_admin()));

-- Records the acceptance of the signed-in user (Google sign-up, onboarding).
create or replace function public.accept_legal_terms(p_version text, p_source text default 'onboarding')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  if p_version is null or p_version !~ '^\d{4}-\d{2}-\d{2}$' or p_source not in ('google', 'onboarding') then
    raise exception 'invalid legal version' using errcode = '22023';
  end if;
  insert into public.legal_acceptances (user_id, version, source)
  values (v_user, p_version, p_source)
  on conflict (user_id, version) do nothing;
end;
$$;

revoke all on function public.accept_legal_terms(text, text) from public, anon;
grant execute on function public.accept_legal_terms(text, text) to authenticated;

-- E-mail sign-up: the form sends `legal_version` in the user metadata (there is no
-- session before the e-mail is confirmed); the row is written when the account is
-- created. It never blocks a sign-up.
create or replace function private.record_signup_legal_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text := new.raw_user_meta_data ->> 'legal_version';
begin
  if v_version ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      insert into public.legal_acceptances (user_id, version, source)
      values (new.id, v_version, 'signup')
      on conflict (user_id, version) do nothing;
    exception when others then
      raise warning 'legal acceptance not recorded for %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.record_signup_legal_acceptance() from public, anon, authenticated;

create trigger on_auth_user_created_legal
  after insert on auth.users
  for each row execute function private.record_signup_legal_acceptance();
