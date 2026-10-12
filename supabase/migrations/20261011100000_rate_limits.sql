-- Generic rate limiter for authenticated, non-public endpoints (the public RPCs
-- count their own rows). One row per accepted call; the private schema is not
-- exposed by the Data API and the table is closed to every API role.

create table if not exists private.rate_limit_events (
  bucket text not null,
  subject text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_lookup_idx
  on private.rate_limit_events (bucket, subject, created_at desc);

alter table private.rate_limit_events enable row level security;
revoke all on private.rate_limit_events from public, anon, authenticated;

-- Raises PT429 when `subject` already made `p_max` calls in `bucket` during
-- `p_window`, otherwise records this call. Rows are tiny and the limited calls
-- are rare; old rows (older than any window) can be removed by staff at will.
create or replace function private.hit_rate_limit(
  p_bucket text,
  p_subject text,
  p_max integer,
  p_window interval
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_bucket is null or p_subject is null or p_max < 1 then
    raise exception 'invalid rate limit' using errcode = '22023';
  end if;

  select count(*) into v_count
  from private.rate_limit_events
  where bucket = p_bucket and subject = p_subject and created_at > now() - p_window;

  if v_count >= p_max then
    raise exception 'rate limited' using errcode = 'PT429';
  end if;

  insert into private.rate_limit_events (bucket, subject) values (p_bucket, p_subject);
end;
$$;

revoke all on function private.hit_rate_limit(text, text, integer, interval) from public, anon, authenticated;

-- Access requests: at most 10 submissions or edits per account per hour.
create or replace function public.submit_access_request(
  p_business_name text,
  p_website text default null,
  p_phone text default null,
  p_message text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_name text := private.clean_text(p_business_name, 120);
  v_status text;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  if not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'email not verified' using errcode = 'PT403';
  end if;
  if exists (select 1 from public.organization_members where user_id = v_user) then
    return 'member';
  end if;
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'business name required' using errcode = '22023';
  end if;
  select status into v_status from public.access_requests where user_id = v_user;
  if v_status = 'rejected' then
    return 'rejected';
  end if;
  perform private.hit_rate_limit('access_request', v_user::text, 10, interval '1 hour');
  insert into public.access_requests (user_id, business_name, website, phone, message)
  values (v_user, v_name, private.clean_text(p_website, 200), private.clean_text(p_phone, 40), private.clean_text(p_message, 1000))
  on conflict (user_id) do update
    set business_name = excluded.business_name, website = excluded.website, phone = excluded.phone,
        message = excluded.message, updated_at = now()
    where public.access_requests.status = 'pending';
  return 'pending';
end;
$function$;

revoke all on function public.submit_access_request(text, text, text, text) from public, anon;
grant execute on function public.submit_access_request(text, text, text, text) to authenticated;
