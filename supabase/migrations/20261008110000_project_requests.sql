-- levelup-ecosystem.com "Start a project": qualified project requests.
--
-- The showcase site (publishable key only, no server secret shared with the
-- database) records each finished brief and an AI qualification so LevelUp
-- staff can skip non-serious requests before spending time on a demo.
--
-- Write flow (all through SECURITY DEFINER RPCs; anon/authenticated have no
-- direct table privileges):
--   1. submit_project_request(p_payload) validates and cleans the request,
--      rate-limits it (5 per e-mail per day, 300 per hour overall), stores it
--      with every ai_* column NULL and returns { id, qualify_token }.
--      The token is random, stored only as a SHA-256 digest in
--      private.project_request_tokens, valid 10 minutes and single use.
--   2. The showcase server runs the AI qualification, then calls
--      record_project_qualification(p_id, p_token, p_result) once. The result
--      is validated and clamped here (score 0-100, verdict in the allowed set,
--      bounded text/arrays); anything malformed is stored as verdict 'review'.
--      It also logs which providers answered in public.ai_calls (app 'showcase').
--
-- Accepted risk: the token is handed to whoever called step 1, so a malicious
-- anonymous caller could forge the qualification of ITS OWN request only (never
-- another row, never twice, never after 10 minutes). ai_model is recorded with
-- the result and the dashboard must treat ai_* values as a hint, showing
-- 'review' for rows whose result fails validation. Staff decide via status.
--
-- Reads and review updates (status, notes, reviewed_by, reviewed_at) are for
-- platform admins only, with an aal2 restrictive policy on update.

create table if not exists public.project_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  locale text,
  name text not null,
  email text not null,
  phone text,
  business_name text,
  has_business boolean,
  business_stage text,
  sector text,
  business_age text,
  website text,
  social_links text[] not null default '{}',
  registration_number text,
  proof_links text[] not null default '{}',
  budget text,
  timeline text,
  project_type text,
  brief jsonb not null default '{}',
  ai_score int check (ai_score between 0 and 100),
  ai_verdict text check (ai_verdict in ('qualified', 'review', 'rejected')),
  ai_summary text,
  ai_reasons jsonb default '[]',
  ai_red_flags jsonb default '[]',
  ai_model text,
  status text not null default 'new' check (status in ('new', 'contacted', 'demo', 'won', 'lost', 'rejected')),
  notes text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);

create index if not exists project_requests_created_idx on public.project_requests (created_at desc);
create index if not exists project_requests_email_idx on public.project_requests (lower(email), created_at desc);
create index if not exists project_requests_status_idx on public.project_requests (status, created_at desc);
create index if not exists project_requests_reviewed_by_idx on public.project_requests (reviewed_by);

alter table public.project_requests enable row level security;
revoke all on public.project_requests from public, anon, authenticated;
grant select on public.project_requests to authenticated;
grant update (status, notes, reviewed_by, reviewed_at) on public.project_requests to authenticated;

create policy project_requests_select_platform_admin on public.project_requests
  for select to authenticated
  using ((select private.is_platform_admin()));

create policy project_requests_update_platform_admin on public.project_requests
  for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

-- Same pattern as 20261008070000_mfa_aal2_sensitive_writes.sql (AND-ed, never widens).
create policy project_requests_update_require_aal2 on public.project_requests
  as restrictive for update to authenticated
  using ((select private.mfa_satisfied()))
  with check ((select private.mfa_satisfied()));

-- One-time qualification tokens (digest only), outside the exposed schema.
create table if not exists private.project_request_tokens (
  request_id uuid primary key references public.project_requests (id) on delete cascade,
  token_hash bytea not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
revoke all on private.project_request_tokens from public, anon, authenticated;

-- ai_calls: the showcase site logs its calls too.
alter table public.ai_calls drop constraint if exists ai_calls_app_check;
alter table public.ai_calls add constraint ai_calls_app_check
  check (app in ('studio', 'dashboard', 'site', 'showcase'));

-- Cleans a JSON array of strings: at most p_items entries, each at most p_len chars.
create or replace function private.clean_text_array(p_value jsonb, p_items int, p_len int)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(v order by o), '{}')
  from (
    select private.clean_text(e.value, p_len) as v, e.o
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end
    ) with ordinality as e(value, o)
  ) x
  where v is not null and x.o <= p_items;
$$;
revoke all on function private.clean_text_array(jsonb, int, int) from public;

create or replace function public.submit_project_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_email text := lower(private.clean_text(p ->> 'email', 254));
  v_name text := private.clean_text(p ->> 'name', 120);
  v_business text := private.clean_text(p ->> 'business_name', 160);
  v_website text := private.clean_text(p ->> 'website', 300);
  v_social text[] := private.clean_text_array(p -> 'social_links', 8, 300);
  v_reg text := private.clean_text(p ->> 'registration_number', 40);
  v_activity text := private.clean_text(p ->> 'activity', 2000);
  v_brief jsonb := case when jsonb_typeof(p -> 'brief') = 'object' then p -> 'brief' else '{}'::jsonb end;
  v_id uuid;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if jsonb_typeof(p) <> 'object' or pg_column_size(p) > 48000 then
    raise exception 'invalid payload' using errcode = 'PT400';
  end if;
  if v_name is null or v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'name and a valid email are required' using errcode = 'PT400';
  end if;
  if v_business is null
     or (v_website is null and cardinality(v_social) = 0 and v_reg is null
         and coalesce(char_length(v_activity), 0) < 80) then
    raise exception 'business name and a link, a registration number or a description are required'
      using errcode = 'PT400';
  end if;

  if (select count(*) from public.project_requests where created_at > now() - interval '1 hour') >= 300
     or (select count(*) from public.project_requests
         where lower(email) = v_email and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Too many requests, please try again later' using errcode = 'PT429';
  end if;

  insert into public.project_requests (
    locale, name, email, phone, business_name, has_business, business_stage, sector, business_age,
    website, social_links, registration_number, proof_links, budget, timeline, project_type, brief
  ) values (
    case when p ->> 'locale' in ('fr', 'en') then p ->> 'locale' end,
    v_name,
    v_email,
    private.clean_text(p ->> 'phone', 40),
    v_business,
    case when jsonb_typeof(p -> 'has_business') = 'boolean' then (p ->> 'has_business')::boolean end,
    private.clean_text(p ->> 'business_stage', 80),
    private.clean_text(p ->> 'sector', 120),
    private.clean_text(p ->> 'business_age', 60),
    v_website,
    v_social,
    v_reg,
    private.clean_text_array(p -> 'proof_links', 8, 300),
    private.clean_text(p ->> 'budget', 60),
    private.clean_text(p ->> 'timeline', 60),
    private.clean_text(p ->> 'project_type', 120),
    v_brief || jsonb_build_object('activity', v_activity)
  )
  returning id into v_id;

  insert into private.project_request_tokens (request_id, token_hash, expires_at)
  values (v_id, extensions.digest(v_token, 'sha256'), now() + interval '10 minutes');

  return jsonb_build_object('id', v_id, 'qualify_token', v_token);
end;
$$;
revoke all on function public.submit_project_request(jsonb) from public;
grant execute on function public.submit_project_request(jsonb) to anon, authenticated;

create or replace function public.record_project_qualification(p_id uuid, p_token text, p_result jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := case when jsonb_typeof(p_result) = 'object' then p_result else '{}'::jsonb end;
  v_score int;
  v_verdict text;
  v_valid boolean := true;
  v_call jsonb;
begin
  if p_id is null or p_token is null or char_length(p_token) > 100 then
    raise exception 'invalid token' using errcode = 'PT403';
  end if;

  update private.project_request_tokens t
  set used_at = now()
  where t.request_id = p_id
    and t.used_at is null
    and t.expires_at > now()
    and t.token_hash = extensions.digest(p_token, 'sha256');
  if not found then
    raise exception 'invalid token' using errcode = 'PT403';
  end if;

  if jsonb_typeof(r -> 'score') = 'number' and (r ->> 'score')::numeric between 0 and 100 then
    v_score := round((r ->> 'score')::numeric)::int;
  else
    v_valid := false;
  end if;
  v_verdict := r ->> 'verdict';
  if v_verdict is null or v_verdict not in ('qualified', 'review', 'rejected') then
    v_valid := false;
  end if;

  update public.project_requests
  set ai_score = v_score,
      ai_verdict = case when v_valid then v_verdict else 'review' end,
      ai_summary = private.clean_text(r ->> 'summary', 600),
      ai_reasons = to_jsonb(private.clean_text_array(r -> 'reasons', 8, 200)),
      ai_red_flags = to_jsonb(private.clean_text_array(r -> 'red_flags', 8, 200)),
      ai_model = private.clean_text(r ->> 'model', 80)
  where id = p_id and ai_verdict is null;

  -- Usage counters (no content), at most 4 calls per request.
  for v_call in
    select value from jsonb_array_elements(
      case when jsonb_typeof(r -> 'calls') = 'array' then r -> 'calls' else '[]'::jsonb end
    ) limit 4
  loop
    begin
      insert into public.ai_calls (app, task, provider, model)
      values ('showcase', left(coalesce(v_call ->> 'task', ''), 40), v_call ->> 'provider',
              left(coalesce(v_call ->> 'model', ''), 80));
    exception when check_violation or not_null_violation then
      null;
    end;
  end loop;

  return case when v_valid then v_verdict else 'review' end;
end;
$$;
revoke all on function public.record_project_qualification(uuid, text, jsonb) from public;
grant execute on function public.record_project_qualification(uuid, text, jsonb) to anon, authenticated;
