-- Security watch: every 15 minutes the database looks for signs of an attack
-- or of data theft attempts, records alerts (shown in HQ > Security) and
-- e-mails the HQ owners. Runs entirely inside the database (pg_cron + pg_net);
-- the e-mail provider key lives in Supabase Vault (name 'resend_alerts_key'),
-- added by the owner in the SQL editor, never in code or chat. Without it the
-- alerts are still recorded and visible in HQ.
--
-- Signals (all from data the database already keeps; nothing personal stored):
--   flood        many rate-limited calls on one action (scraping, spam, DoS)
--   brute_force  one subject hitting a limit again and again (codes, sign-in)
--   hq_denied    signed-in accounts that are not HQ staff trying to open HQ
--   team_change  HQ team invited / joined / role changed / deactivated
--   new_admin    a new platform admin (full access to client data)
--   signup_flood unusually many new accounts

create extension if not exists pg_cron;

create table if not exists private.security_alerts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  severity text not null check (severity in ('info', 'medium', 'high')),
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  emailed_at timestamptz
);
create index if not exists security_alerts_recent_idx on private.security_alerts (dedupe_key, created_at desc);
revoke all on private.security_alerts from public, anon, authenticated;

create or replace function private.security_alert(p_kind text, p_severity text, p_title text, p_detail jsonb, p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The same alert at most once every 6 hours.
  if exists (select 1 from private.security_alerts a
             where a.dedupe_key = p_key and a.created_at > now() - interval '6 hours') then
    return false;
  end if;
  insert into private.security_alerts (kind, severity, title, detail, dedupe_key)
  values (p_kind, p_severity, left(p_title, 200), coalesce(p_detail, '{}'::jsonb), left(p_key, 300));
  return true;
end;
$$;

-- How a rate-limit subject shows in an alert: masked e-mail or a short prefix.
create or replace function private.security_subject(p_subject text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_subject is null then '?'
    when position('@' in p_subject) > 0 then private.mask_email(p_subject)
    else left(p_subject, 8) || '…'
  end;
$$;

create or replace function private.security_scan()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_new integer := 0;
  v_count integer;
  v_sent boolean := false;
  v_recipients text[];
  v_lines text;
begin
  -- Flood: one action used an unusual number of times in 15 minutes
  -- (scraping, spam, someone hammering an endpoint).
  for r in
    select e.bucket, count(*) as hits, count(distinct e.subject) as sources
    from private.rate_limit_events e
    where e.created_at > now() - interval '15 minutes'
    group by e.bucket
    having count(*) >= 100
  loop
    if private.security_alert('flood', case when r.hits >= 500 then 'high' else 'medium' end,
         'Unusual traffic on ' || r.bucket,
         jsonb_build_object('action', r.bucket, 'calls_15min', r.hits, 'sources', r.sources),
         'flood:' || r.bucket) then
      v_new := v_new + 1;
    end if;
  end loop;

  -- Guessing: one source retrying codes / verifications / activations.
  for r in
    select e.bucket, e.subject, count(*) as hits
    from private.rate_limit_events e
    where e.created_at > now() - interval '1 hour'
      and e.bucket ~ '(code|verify|activation|sign_in|login|password|join|claim)'
    group by e.bucket, e.subject
    having count(*) >= 5
  loop
    if private.security_alert('brute_force', 'high',
         'Repeated attempts on ' || r.bucket,
         jsonb_build_object('action', r.bucket, 'source', private.security_subject(r.subject), 'attempts_1h', r.hits),
         'brute:' || r.bucket || ':' || md5(r.subject)) then
      v_new := v_new + 1;
    end if;
  end loop;

  -- Wrong activation codes (someone guessing a site owner code).
  select count(*) into v_count
  from public.hq_audit_log l
  where l.action = 'site.activation_code_failed' and l.created_at > now() - interval '1 hour';
  if v_count >= 3 then
    if private.security_alert('brute_force', 'high', 'Wrong site activation codes',
         jsonb_build_object('failures_1h', v_count), 'activation_failed') then
      v_new := v_new + 1;
    end if;
  end if;

  -- Accounts outside the HQ team trying to open HQ.
  for r in
    select l.actor_email, count(*) as tries
    from public.hq_audit_log l
    where l.action = 'access.denied' and l.created_at > now() - interval '15 minutes'
    group by l.actor_email
  loop
    if private.security_alert('hq_denied', case when r.tries >= 3 then 'high' else 'medium' end,
         'Someone outside the team tried to open HQ',
         jsonb_build_object('account', private.mask_email(coalesce(r.actor_email, '')), 'tries', r.tries),
         'hq_denied:' || md5(coalesce(r.actor_email, '?'))) then
      v_new := v_new + 1;
    end if;
  end loop;

  -- Sensitive changes: HQ team, provider keys, sign-in settings.
  for r in
    select l.id, l.action, l.actor_email, l.target_type
    from public.hq_audit_log l
    where (l.action like 'staff.%' or l.action like 'key.%' or l.action like 'settings.%')
      and l.created_at > now() - interval '15 minutes'
  loop
    if private.security_alert('team_change',
         case when r.action in ('staff.role_changed', 'key.rotated') then 'high' else 'info' end,
         'Sensitive change: ' || r.action,
         jsonb_build_object('by', coalesce(r.actor_email, 'system'), 'target', r.target_type),
         'change:' || r.id::text) then
      v_new := v_new + 1;
    end if;
  end loop;

  -- New platform admins (full access to client data).
  for r in
    select p.user_id, u.email
    from public.platform_admins p left join auth.users u on u.id = p.user_id
    where p.created_at > now() - interval '15 minutes'
  loop
    if private.security_alert('new_admin', 'high', 'New platform admin',
         jsonb_build_object('account', private.mask_email(coalesce(r.email, ''))),
         'admin:' || r.user_id::text) then
      v_new := v_new + 1;
    end if;
  end loop;

  -- Sign-up floods (bots creating accounts).
  select count(*) into v_count from auth.users u where u.created_at > now() - interval '15 minutes';
  if v_count >= 30 then
    if private.security_alert('signup_flood', 'medium', 'Unusually many new accounts',
         jsonb_build_object('accounts_15min', v_count), 'signups') then
      v_new := v_new + 1;
    end if;
  end if;

  -- Keep 180 days of alerts.
  delete from private.security_alerts where created_at < now() - interval '180 days';

  -- E-mail the HQ owners about medium/high alerts not sent yet. Needs the
  -- Resend key in Vault ('resend_alerts_key'); without it nothing is sent and
  -- the alerts stay visible in HQ.
  if exists (select 1 from private.security_alerts a
             where a.emailed_at is null and a.severity <> 'info' and a.created_at > now() - interval '1 day')
     and exists (select 1 from vault.decrypted_secrets s where s.name = 'resend_alerts_key') then
    select coalesce(array_agg(u.email), '{}') into v_recipients
    from public.hq_staff s join auth.users u on u.id = s.user_id
    where s.role = 'owner' and s.active and u.email is not null;
    select string_agg('- [' || upper(a.severity) || '] ' || a.title || ' ' || a.detail::text, E'\n' order by a.id)
    into v_lines
    from private.security_alerts a
    where a.emailed_at is null and a.severity <> 'info' and a.created_at > now() - interval '1 day';
    if cardinality(v_recipients) > 0 then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select s.decrypted_secret from vault.decrypted_secrets s
                                         where s.name = 'resend_alerts_key' limit 1)),
        body := jsonb_build_object(
          'from', 'LevelUp Security <account@levelup-ecosystem.com>',
          'to', to_jsonb(v_recipients),
          'subject', 'LevelUp security alert',
          'text', 'The LevelUp database noticed something unusual:' || E'\n\n' || v_lines
                  || E'\n\nOpen HQ > Security: https://hq.levelup-ecosystem.com/dashboard/hq-security')
      );
      v_sent := true;
    end if;
  end if;
  if v_sent then
    update private.security_alerts set emailed_at = now()
    where emailed_at is null and severity <> 'info' and created_at > now() - interval '1 day';
  end if;

  return v_new;
end;
$$;
revoke all on function private.security_scan() from public, anon, authenticated;
revoke all on function private.security_alert(text, text, text, jsonb, text) from public, anon, authenticated;

-- Every 15 minutes.
select cron.unschedule(jobid) from cron.job where jobname = 'security-scan';
select cron.schedule('security-scan', '*/15 * * * *', $$select private.security_scan()$$);

-- HQ > Security: recent alerts (same right as the audit log).
create or replace function public.hq_security_alerts(p_days integer default 30, p_page integer default 1, p_per_page integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 180);
  v_per integer := least(greatest(coalesce(p_per_page, 50), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
begin
  perform private.hq_assert('audit.read');
  return jsonb_build_object(
    'total', (select count(*) from private.security_alerts a where a.created_at > now() - make_interval(days => v_days)),
    'high', (select count(*) from private.security_alerts a
             where a.severity = 'high' and a.created_at > now() - make_interval(days => v_days)),
    'emailing', exists (select 1 from vault.secrets s where s.name = 'resend_alerts_key'),
    'last_scan', (select max(d.end_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                  where j.jobname = 'security-scan' and d.status = 'succeeded'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'created_at', a.created_at, 'kind', a.kind, 'severity', a.severity,
               'title', a.title, 'detail', a.detail, 'emailed', a.emailed_at is not null)
             order by a.created_at desc)
      from (select * from private.security_alerts a
            where a.created_at > now() - make_interval(days => v_days)
            order by a.created_at desc
            offset (v_page - 1) * v_per limit v_per) a), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.hq_security_alerts(integer, integer, integer) from public, anon;
grant execute on function public.hq_security_alerts(integer, integer, integer) to authenticated;
