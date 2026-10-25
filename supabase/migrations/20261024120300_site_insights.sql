-- What a website has, and what happened on it: the reads behind the adaptive
-- dashboard (overview, capabilities page, data-driven navigation, activity
-- bell, generic forms inbox). All SECURITY INVOKER: Row Level Security of
-- each table decides what the caller sees, so a member of another
-- organization gets zero counts and empty lists.
--
-- Also opens form_submissions to any form a site sends (custom form types,
-- e.g. "volunteer_signup") and adds the "archived" inbox status.

-- ---------------------------------------------------------------- custom form types

alter table public.form_submissions drop constraint if exists form_submissions_form_type_check;
alter table public.form_submissions add constraint form_submissions_form_type_check
  check (form_type ~ '^[a-z][a-z0-9_]{1,39}$');

alter table public.form_submissions drop constraint if exists form_submissions_status_check;
alter table public.form_submissions add constraint form_submissions_status_check
  check (status in ('new', 'contacted', 'in_progress', 'quoted', 'won', 'lost', 'closed',
                    'archived', 'spam'));

create index if not exists form_submissions_site_type_time_idx
  on public.form_submissions (website_id, form_type, created_at desc);

-- Known types keep their feature; any other well-formed type is a custom form
-- of the website and needs the contact_form feature.
create or replace function public.submit_form(
  p_website_id text,
  p_form_type text,
  p_name text default null,
  p_email text default null,
  p_phone text default null,
  p_company text default null,
  p_message text default null,
  p_data jsonb default '{}'::jsonb,
  p_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org uuid;
  v_feature text;
  v_name text;
  v_email text;
  v_phone text;
  v_company text;
  v_message text;
  v_data jsonb;
  v_ticket text;
begin
  if p_website_id is null or p_website_id !~ '^ws_[a-z0-9]{8,32}$' or not private.is_website_live(p_website_id) then
    raise exception 'Website not found' using errcode = 'PT404';
  end if;
  if p_form_type is null or p_form_type !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Unknown form type' using errcode = '22023';
  end if;
  v_feature := case p_form_type
    when 'quote' then 'quotes'
    when 'vip_signup' then 'newsletter'
    when 'newsletter' then 'newsletter'
    else 'contact_form'
  end;
  if not private.website_has_feature(p_website_id, v_feature) then
    raise exception 'This form is not available' using errcode = 'PT403';
  end if;

  v_name := private.check_text(p_name, 120, 'name');
  v_email := lower(private.check_text(p_email, 254, 'email'));
  v_phone := private.check_text(p_phone, 40, 'phone');
  v_company := private.check_text(p_company, 160, 'company');
  v_message := private.check_text(p_message, 5000, 'message', true);

  if v_email is null and v_phone is null then
    raise exception 'An email or phone number is required' using errcode = '22023';
  end if;
  if v_email is not null and not private.is_valid_email(v_email) then
    raise exception 'Invalid email address' using errcode = '22023';
  end if;
  if v_phone is not null and not private.is_valid_phone(v_phone) then
    raise exception 'Invalid phone number' using errcode = '22023';
  end if;

  if p_data is not null and jsonb_typeof(p_data) <> 'object' then
    raise exception 'Invalid data' using errcode = '22023';
  end if;
  if pg_column_size(p_data) > 16384 then
    raise exception 'Data is too large' using errcode = '22023';
  end if;
  v_data := private.clean_jsonb(coalesce(p_data, '{}'::jsonb));
  if pg_column_size(v_data) > 8192 then
    raise exception 'Data is too large' using errcode = '22023';
  end if;

  perform private.assert_public_write_allowed(p_website_id, v_email, v_phone);
  select organization_id into v_org from public.websites where id = p_website_id;
  v_ticket := private.generate_ticket_code(private.ticket_prefix(p_website_id));
  insert into public.form_submissions (
    website_id, organization_id, form_type, ticket_code, name, email, phone, company, message, data, source
  ) values (
    p_website_id, v_org, p_form_type, v_ticket,
    v_name, v_email, v_phone, v_company, v_message,
    v_data, private.clean_line(p_source, 80)
  );
  return jsonb_build_object('ticket_code', v_ticket);
end;
$function$;

-- ---------------------------------------------------------------- capabilities

-- Everything a website has: enabled features, how many rows of each kind of
-- content / interaction exist, the forms detected, freshness and the tag.
create or replace function public.site_capabilities(p_website_id text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'website_id', w.id,
    'features', coalesce((select jsonb_agg(f.feature_key order by f.feature_key)
      from public.website_features f where f.website_id = w.id and f.enabled), '[]'::jsonb),
    'counts', jsonb_build_object(
      'appointments', (select count(*) from public.appointments where website_id = w.id),
      'waitlist', (select count(*) from public.waitlist_entries where website_id = w.id),
      'submissions', (select count(*) from public.form_submissions where website_id = w.id),
      'services', (select count(*) from public.services where website_id = w.id),
      'team', (select count(*) from public.team_members where website_id = w.id),
      'gallery', (select count(*) from public.gallery_items where website_id = w.id),
      'reviews', (select count(*) from public.reviews where website_id = w.id),
      'faq', (select count(*) from public.faq_items where website_id = w.id),
      'announcements', (select count(*) from public.announcements where website_id = w.id),
      'templates', (select count(*) from public.showcase_templates where website_id = w.id),
      'case-studies', (select count(*) from public.showcase_projects where website_id = w.id),
      'page-sections', (select count(*) from public.showcase_sections where website_id = w.id),
      'content_blocks', (select count(*) from public.content_blocks where website_id = w.id),
      'media', (select count(*) from public.media where website_id = w.id),
      'settings', (select count(*) from public.website_settings where website_id = w.id),
      'payments', (select count(*) from public.site_payments where website_id = w.id),
      'traffic_days', (select count(*) from public.site_traffic_daily where website_id = w.id),
      'api_keys', (select count(*) from public.site_api_keys
                   where website_id = w.id and revoked_at is null)
    ),
    'forms', coalesce((select jsonb_agg(x order by (x ->> 'total')::int desc) from (
      select jsonb_build_object('form_type', s.form_type, 'total', count(*),
        'new', count(*) filter (where s.status = 'new'), 'last_at', max(s.created_at)) as x
      from public.form_submissions s where s.website_id = w.id group by s.form_type) f), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(distinct b.page) from public.content_blocks b
      where b.website_id = w.id), '[]'::jsonb),
    'settings_keys', coalesce((select jsonb_agg(s.key order by s.key) from public.website_settings s
      where s.website_id = w.id), '[]'::jsonb),
    'last_content_update', greatest(
      (select max(updated_at) from public.services where website_id = w.id),
      (select max(updated_at) from public.team_members where website_id = w.id),
      (select max(updated_at) from public.gallery_items where website_id = w.id),
      (select max(updated_at) from public.reviews where website_id = w.id),
      (select max(updated_at) from public.faq_items where website_id = w.id),
      (select max(updated_at) from public.announcements where website_id = w.id),
      (select max(updated_at) from public.content_blocks where website_id = w.id),
      (select max(updated_at) from public.website_settings where website_id = w.id),
      (select max(updated_at) from public.showcase_templates where website_id = w.id),
      (select max(updated_at) from public.showcase_projects where website_id = w.id),
      (select max(updated_at) from public.showcase_sections where website_id = w.id),
      (select max(created_at) from public.media where website_id = w.id)),
    'tag', jsonb_build_object('last_seen_at', w.tag_last_seen_at, 'version', w.tag_version,
                              'origin', w.tag_last_seen_origin),
    'last_payment_at', (select max(occurred_at) from public.site_payments where website_id = w.id),
    'last_visit_day', (select max(day) from public.site_traffic_daily where website_id = w.id)
  )
  from public.websites w
  where w.id = p_website_id;
$$;

-- ---------------------------------------------------------------- overview

-- KPIs and daily series of the last p_days days (and the previous period for
-- comparison). Days follow the dashboard time zone (America/Toronto).
create or replace function public.site_overview_stats(p_website_id text, p_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 366);
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_from_day date;
  v_from timestamptz;
  v_prev timestamptz;
  v_tz text := 'America/Toronto';
begin
  v_from_day := v_today - (v_days - 1);
  v_from := (v_from_day::timestamp) at time zone v_tz;
  v_prev := ((v_today - (2 * v_days - 1))::timestamp) at time zone v_tz;

  return jsonb_build_object(
    'days', v_days,
    'from', v_from_day,
    'to', v_today,
    'submissions', jsonb_build_object(
      'series', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'form_type', t, 'count', n)
          order by d, t) from (
        select (created_at at time zone v_tz)::date as d, form_type as t, count(*) as n
        from public.form_submissions
        where website_id = p_website_id and created_at >= v_from and status <> 'spam'
        group by 1, 2) s), '[]'::jsonb),
      'by_type', coalesce((select jsonb_agg(jsonb_build_object('form_type', t, 'count', n,
          'previous', p) order by n desc) from (
        select form_type as t,
               count(*) filter (where created_at >= v_from) as n,
               count(*) filter (where created_at < v_from) as p
        from public.form_submissions
        where website_id = p_website_id and created_at >= v_prev and status <> 'spam'
        group by 1) s), '[]'::jsonb),
      'open', (select count(*) from public.form_submissions where website_id = p_website_id
               and status in ('new', 'contacted', 'in_progress', 'quoted')),
      'new', (select count(*) from public.form_submissions where website_id = p_website_id
              and status = 'new')
    ),
    'quotes', jsonb_build_object(
      'open', (select count(*) from public.form_submissions where website_id = p_website_id
               and form_type = 'quote' and status in ('new', 'contacted', 'in_progress', 'quoted')),
      'in_range', (select count(*) from public.form_submissions where website_id = p_website_id
                   and form_type = 'quote' and created_at >= v_from and status <> 'spam'),
      'won', (select count(*) from public.form_submissions where website_id = p_website_id
              and form_type = 'quote' and status = 'won' and updated_at >= v_from)
    ),
    'newsletter', jsonb_build_object(
      'total', (select count(*) from public.form_submissions where website_id = p_website_id
                and form_type in ('newsletter', 'vip_signup') and status <> 'spam'),
      'in_range', (select count(*) from public.form_submissions where website_id = p_website_id
                   and form_type in ('newsletter', 'vip_signup') and status <> 'spam'
                   and created_at >= v_from)
    ),
    'bookings', jsonb_build_object(
      'today', (select count(*) from public.appointments where website_id = p_website_id
                and appointment_date = v_today and status in ('pending', 'confirmed', 'completed')),
      'upcoming', (select count(*) from public.appointments where website_id = p_website_id
                   and appointment_date >= v_today and status in ('pending', 'confirmed')),
      'pending', (select count(*) from public.appointments where website_id = p_website_id
                  and status = 'pending' and appointment_date >= v_today),
      'in_range', (select count(*) from public.appointments where website_id = p_website_id
                   and created_at >= v_from),
      'previous', (select count(*) from public.appointments where website_id = p_website_id
                   and created_at >= v_prev and created_at < v_from),
      'no_shows', (select count(*) from public.appointments where website_id = p_website_id
                   and status = 'no_show' and appointment_date >= v_from_day),
      'completed', (select count(*) from public.appointments where website_id = p_website_id
                    and status = 'completed' and appointment_date >= v_from_day),
      'series', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'count', n) order by d) from (
        select appointment_date as d, count(*) as n from public.appointments
        where website_id = p_website_id and appointment_date between v_from_day and v_today + 14
          and status <> 'cancelled'
        group by 1) s), '[]'::jsonb)
    ),
    'waitlist', jsonb_build_object(
      'waiting', (select count(*) from public.waitlist_entries where website_id = p_website_id
                  and status in ('waiting', 'called')),
      'served_today', (select count(*) from public.waitlist_entries where website_id = p_website_id
                       and status = 'served' and (joined_at at time zone v_tz)::date = v_today),
      'in_range', (select count(*) from public.waitlist_entries where website_id = p_website_id
                   and joined_at >= v_from)
    ),
    'reviews', (select jsonb_build_object(
        'count', count(*) filter (where status = 'published'),
        'average', round(avg(rating) filter (where status = 'published' and rating is not null), 2),
        'new', count(*) filter (where created_at >= v_from))
      from public.reviews where website_id = p_website_id),
    'traffic', (select jsonb_build_object(
        'views', coalesce(sum(views) filter (where day >= v_from_day), 0),
        'visitors', coalesce(sum(visitors) filter (where day >= v_from_day), 0),
        'previous_visitors', coalesce(sum(visitors) filter (where day < v_from_day), 0),
        'series', coalesce(jsonb_agg(jsonb_build_object('day', day, 'views', views,
          'visitors', visitors) order by day) filter (where day >= v_from_day), '[]'::jsonb))
      from public.site_traffic_daily
      where website_id = p_website_id and day >= v_today - (2 * v_days - 1)),
    'payments', public.site_payments_summary(p_website_id, v_days, true)
  );
end;
$$;

-- ---------------------------------------------------------------- activity

-- Latest things that happened on the website (bell in the header). Payments
-- show the offer and amount only.
create or replace function public.site_recent_activity(p_website_id text, p_limit integer default 20)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(a order by (a ->> 'at') desc), '[]'::jsonb)
  from (
    select x.a from (
      (select jsonb_build_object('kind', 'submission', 'id', id, 'at', created_at,
          'label', form_type, 'title', coalesce(name, email, phone, ticket_code), 'status', status) as a,
          created_at as at
        from public.form_submissions where website_id = p_website_id and status <> 'spam'
        order by created_at desc limit 20)
      union all
      (select jsonb_build_object('kind', 'appointment', 'id', id, 'at', created_at,
          'label', coalesce(service_name, ''), 'title', customer_name,
          'date', appointment_date, 'time', appointment_time, 'status', status), created_at
        from public.appointments where website_id = p_website_id
        order by created_at desc limit 20)
      union all
      (select jsonb_build_object('kind', 'waitlist', 'id', id, 'at', joined_at,
          'label', coalesce(service_name, ''), 'title', customer_name, 'status', status), joined_at
        from public.waitlist_entries where website_id = p_website_id
        order by joined_at desc limit 20)
      union all
      (select jsonb_build_object('kind', 'payment', 'id', id, 'at', occurred_at,
          'label', coalesce(offer_name, offer_id, ''), 'amount', amount, 'currency', currency,
          'status', status), occurred_at
        from public.site_payments where website_id = p_website_id and livemode
        order by occurred_at desc limit 20)
      union all
      (select jsonb_build_object('kind', 'review', 'id', id, 'at', created_at,
          'label', coalesce(source, ''), 'title', author, 'rating', rating, 'status', status), created_at
        from public.reviews where website_id = p_website_id
        order by created_at desc limit 20)
    ) x
    order by x.at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) y;
$$;

-- ---------------------------------------------------------------- forms inbox

-- Generic inbox for any form type: filter, search (every text column and the
-- JSON data), paginate. RLS decides which rows exist for the caller.
create or replace function public.site_submissions_list(
  p_website_id text,
  p_form_type text default null,
  p_status text[] default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_q text := nullif(left(btrim(regexp_replace(coalesce(p_search, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 100), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_total bigint;
  v_rows jsonb;
begin
  if v_q is not null then
    v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  with filtered as (
    select s.id, s.form_type, s.ticket_code, s.name, s.email, s.phone, s.company, s.message,
           s.data, s.status, s.staff_notes, s.source, s.created_at, s.updated_at
    from public.form_submissions s
    where s.website_id = p_website_id
      and (p_form_type is null or s.form_type = p_form_type)
      and (p_status is null or cardinality(p_status) = 0 or s.status = any (p_status))
      and (v_q is null or s.ticket_code ilike v_q or s.name ilike v_q or s.email ilike v_q
        or s.phone ilike v_q or s.company ilike v_q or s.message ilike v_q
        or s.staff_notes ilike v_q or s.data::text ilike v_q)
  )
  select (select count(*) from filtered),
         coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from (
           select * from filtered order by created_at desc limit v_limit offset v_offset) p), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke all on function public.site_capabilities(text) from public, anon;
revoke all on function public.site_overview_stats(text, integer) from public, anon;
revoke all on function public.site_recent_activity(text, integer) from public, anon;
revoke all on function public.site_submissions_list(text, text, text[], text, integer, integer) from public, anon;
grant execute on function public.site_capabilities(text) to authenticated;
grant execute on function public.site_overview_stats(text, integer) to authenticated;
grant execute on function public.site_recent_activity(text, integer) to authenticated;
grant execute on function public.site_submissions_list(text, text, text[], text, integer, integer) to authenticated;
