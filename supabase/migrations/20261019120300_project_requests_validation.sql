-- "Start a project" functions: inputs checked before anything is stored
-- (security hardening). Same signatures and answers as before.
--
-- submit_project_request(p_payload):
--   - payload: a JSON object of at most 48 KB, only the known keys (anything
--     else is refused), arrays and the brief must have the right JSON type;
--   - name 120 (required), email 254 (valid address), phone 40 (valid when
--     given), business name 160 (required), website 300 (http(s) link when
--     given), stage / sector / age / budget / timeline / project type, the
--     registration number and the description: cleaned, refused when too
--     long or when they hold HTML markup (they used to be cut silently);
--   - social / proof links: only http(s) links or @handles are kept (8 x 300);
--   - brief: cleaned with private.clean_jsonb (strings 5000 without HTML,
--     100 keys, 5 levels), at most 40 KB.
--   Refusals keep the PT400 code the showcase already maps to "incomplete".
-- record_project_qualification / create_project_handoff: the token must have
-- the exact format issued by submit_project_request; the AI result is at most
-- 16 KB (refused before the token is used up).
create or replace function public.submit_project_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p jsonb := p_payload;
  v_unknown text;
  v_name text;
  v_email text;
  v_phone text;
  v_business text;
  v_website text;
  v_social text[];
  v_proof text[];
  v_reg text;
  v_activity text;
  v_stage text;
  v_sector text;
  v_age text;
  v_budget text;
  v_timeline text;
  v_type text;
  v_brief jsonb;
  v_id uuid;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 48000 then
    raise exception 'invalid payload' using errcode = 'PT400';
  end if;
  select k into v_unknown
  from jsonb_object_keys(p) as k
  where k not in (
    'locale', 'name', 'email', 'phone', 'business_name', 'has_business', 'business_stage', 'sector',
    'business_age', 'website', 'social_links', 'registration_number', 'proof_links', 'budget',
    'timeline', 'project_type', 'activity', 'brief'
  )
  limit 1;
  if v_unknown is not null
     or coalesce(jsonb_typeof(p -> 'brief'), 'null') not in ('object', 'null')
     or coalesce(jsonb_typeof(p -> 'social_links'), 'null') not in ('array', 'null')
     or coalesce(jsonb_typeof(p -> 'proof_links'), 'null') not in ('array', 'null')
     or coalesce(jsonb_typeof(p -> 'has_business'), 'null') not in ('boolean', 'null') then
    raise exception 'invalid payload' using errcode = 'PT400';
  end if;

  begin
    v_name := private.check_text(p ->> 'name', 120, 'name');
    v_email := lower(private.check_text(p ->> 'email', 254, 'email'));
    v_phone := private.check_text(p ->> 'phone', 40, 'phone');
    v_business := private.check_text(p ->> 'business_name', 160, 'business name');
    v_website := private.check_url(p ->> 'website', 300, 'website');
    v_reg := private.check_text(p ->> 'registration_number', 40, 'registration number');
    v_activity := private.check_text(p ->> 'activity', 2000, 'description', true);
    v_stage := private.check_text(p ->> 'business_stage', 80, 'stage');
    v_sector := private.check_text(p ->> 'sector', 120, 'sector');
    v_age := private.check_text(p ->> 'business_age', 60, 'business age');
    v_budget := private.check_text(p ->> 'budget', 60, 'budget');
    v_timeline := private.check_text(p ->> 'timeline', 60, 'timeline');
    v_type := private.check_text(p ->> 'project_type', 120, 'project type');
    v_brief := private.clean_jsonb(coalesce(nullif(p -> 'brief', 'null'::jsonb), '{}'::jsonb));
  exception when sqlstate '22023' then
    raise exception '%', sqlerrm using errcode = 'PT400';
  end;
  v_social := private.clean_link_array(p -> 'social_links', 8, 300);
  v_proof := private.clean_link_array(p -> 'proof_links', 8, 300);

  if v_name is null or not private.is_valid_email(v_email) then
    raise exception 'name and a valid email are required' using errcode = 'PT400';
  end if;
  if v_phone is not null and not private.is_valid_phone(v_phone) then
    raise exception 'Invalid phone number' using errcode = 'PT400';
  end if;
  if v_business is null
     or (v_website is null and cardinality(v_social) = 0 and v_reg is null
         and coalesce(char_length(v_activity), 0) < 80) then
    raise exception 'business name and a link, a registration number or a description are required'
      using errcode = 'PT400';
  end if;
  if pg_column_size(v_brief) > 40000 then
    raise exception 'invalid payload' using errcode = 'PT400';
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
    v_phone,
    v_business,
    case when jsonb_typeof(p -> 'has_business') = 'boolean' then (p ->> 'has_business')::boolean end,
    v_stage,
    v_sector,
    v_age,
    v_website,
    v_social,
    v_reg,
    v_proof,
    v_budget,
    v_timeline,
    v_type,
    v_brief || jsonb_build_object('activity', v_activity)
  )
  returning id into v_id;

  insert into private.project_request_tokens (request_id, token_hash, expires_at)
  values (v_id, extensions.digest(v_token, 'sha256'), now() + interval '10 minutes');

  return jsonb_build_object('id', v_id, 'qualify_token', v_token);
end;
$$;

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
  if p_id is null or p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    raise exception 'invalid token' using errcode = 'PT403';
  end if;
  if pg_column_size(p_result) > 16384 then
    raise exception 'invalid payload' using errcode = 'PT400';
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
      ai_summary = private.clean_line(r ->> 'summary', 600),
      ai_reasons = to_jsonb(private.clean_text_array(r -> 'reasons', 8, 200)),
      ai_red_flags = to_jsonb(private.clean_text_array(r -> 'red_flags', 8, 200)),
      ai_model = private.clean_line(r ->> 'model', 80)
  where id = p_id and ai_verdict is null;

  -- Usage counters (no content), at most 4 calls per request.
  for v_call in
    select value from jsonb_array_elements(
      case when jsonb_typeof(r -> 'calls') = 'array' then r -> 'calls' else '[]'::jsonb end
    ) limit 4
  loop
    begin
      insert into public.ai_calls (app, task, provider, model)
      values ('showcase', coalesce(private.clean_line(v_call ->> 'task', 40), ''),
              private.clean_line(v_call ->> 'provider', 40),
              coalesce(private.clean_line(v_call ->> 'model', 80), ''));
    exception when check_violation or not_null_violation then
      null;
    end;
  end loop;

  return case when v_valid then v_verdict else 'review' end;
end;
$$;

create or replace function public.create_project_handoff(p_id uuid, p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');
begin
  if p_id is null or p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    raise exception 'invalid token' using errcode = 'PT403';
  end if;
  perform 1 from private.project_request_tokens t
  where t.request_id = p_id
    and t.used_at is null
    and t.expires_at > now()
    and t.token_hash = extensions.digest(p_token, 'sha256');
  if not found then
    raise exception 'invalid token' using errcode = 'PT403';
  end if;

  insert into private.project_handoffs (request_id, code_hash, expires_at)
  values (p_id, extensions.digest(v_code, 'sha256'), now() + interval '7 days')
  on conflict (request_id) do nothing;
  if not found then
    raise exception 'handoff already created' using errcode = 'PT409';
  end if;
  return v_code;
end;
$$;
