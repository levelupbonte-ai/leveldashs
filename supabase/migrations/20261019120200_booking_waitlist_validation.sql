-- book_appointment / join_waitlist: inputs checked before anything is stored
-- (security hardening). Same signatures and answers as before; new refusals
-- are 22023 with a short neutral message:
--   - website id format; service and team member slugs must look like slugs
--     (anything else is "Unknown service" / "Unknown team member");
--   - name 120 (required), email 254 (valid address), phone 40 (digits and
--     + ( ) . -), notes 2000 (multi-line): cleaned, refused when too long or
--     when they hold HTML markup (they used to be cut silently).
create or replace function public.book_appointment(
  p_website_id text,
  p_service_slug text,
  p_date date,
  p_time time without time zone,
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_team_member_slug text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_service public.services;
  v_member public.team_members;
  v_name text;
  v_email text;
  v_phone text;
  v_notes text;
  v_ticket text;
begin
  if p_website_id is null or p_website_id !~ '^ws_[a-z0-9]{8,32}$' or not private.is_website_live(p_website_id) then
    raise exception 'Website not found' using errcode = 'PT404';
  end if;
  if not private.website_has_feature(p_website_id, 'bookings') then
    raise exception 'Online booking is not available' using errcode = 'PT403';
  end if;
  v_name := private.check_text(p_name, 120, 'name');
  v_email := lower(private.check_text(p_email, 254, 'email'));
  v_phone := private.check_text(p_phone, 40, 'phone');
  v_notes := private.check_text(p_notes, 2000, 'notes', true);
  if v_name is null then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'An email or phone number is required' using errcode = '22023';
  end if;
  if v_email is not null and not private.is_valid_email(v_email) then
    raise exception 'Invalid email address' using errcode = '22023';
  end if;
  if v_phone is not null and not private.is_valid_phone(v_phone) then
    raise exception 'Invalid phone number' using errcode = '22023';
  end if;
  if p_date is null or p_time is null
     or p_date < (now() at time zone 'UTC')::date - 1
     or p_date > (now() at time zone 'UTC')::date + 366 then
    raise exception 'Invalid date' using errcode = '22023';
  end if;
  if p_service_slug is null or p_service_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$' then
    raise exception 'Unknown service' using errcode = '22023';
  end if;
  select * into v_service from public.services
  where website_id = p_website_id and slug = p_service_slug and status = 'published';
  if not found then
    raise exception 'Unknown service' using errcode = '22023';
  end if;
  if p_team_member_slug is not null and p_team_member_slug <> '' then
    if p_team_member_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$' then
      raise exception 'Unknown team member' using errcode = '22023';
    end if;
    select * into v_member from public.team_members
    where website_id = p_website_id and slug = p_team_member_slug and status = 'published';
    if not found then
      raise exception 'Unknown team member' using errcode = '22023';
    end if;
  end if;
  perform private.assert_public_write_allowed(p_website_id, v_email, v_phone);
  select organization_id into v_org from public.websites where id = p_website_id;
  v_ticket := private.generate_ticket_code(private.ticket_prefix(p_website_id));
  begin
    insert into public.appointments (
      website_id, organization_id, ticket_code, customer_name, customer_email, customer_phone,
      service_id, service_name, price_label, team_member_id, team_member_name,
      appointment_date, appointment_time, notes, source
    ) values (
      p_website_id, v_org, v_ticket, v_name, v_email, v_phone,
      v_service.id, v_service.name, v_service.price_label, v_member.id, v_member.name,
      p_date, p_time, v_notes, 'website'
    );
  exception when unique_violation then
    raise exception 'This time slot is no longer available' using errcode = 'PT409';
  end;
  return jsonb_build_object(
    'ticket_code', v_ticket, 'service_name', v_service.name, 'price_label', v_service.price_label,
    'team_member_name', v_member.name, 'appointment_date', p_date, 'appointment_time', p_time,
    'status', 'pending'
  );
end;
$$;

create or replace function public.join_waitlist(
  p_website_id text,
  p_name text,
  p_phone text default null,
  p_email text default null,
  p_service_slug text default null,
  p_team_member_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_member public.team_members;
  v_service_name text;
  v_name text;
  v_email text;
  v_phone text;
  v_position integer;
  v_minutes_per_client integer;
  v_ticket text;
begin
  if p_website_id is null or p_website_id !~ '^ws_[a-z0-9]{8,32}$' or not private.is_website_live(p_website_id) then
    raise exception 'Website not found' using errcode = 'PT404';
  end if;
  if not private.website_has_feature(p_website_id, 'waitlist') then
    raise exception 'The waitlist is not available' using errcode = 'PT403';
  end if;
  if coalesce((
    select (value ->> 'open')::boolean from public.website_settings
    where website_id = p_website_id and key = 'waitlist'
  ), false) is not true then
    raise exception 'The waitlist is currently closed' using errcode = 'PT403';
  end if;
  v_name := private.check_text(p_name, 120, 'name');
  v_email := lower(private.check_text(p_email, 254, 'email'));
  v_phone := private.check_text(p_phone, 40, 'phone');
  if v_name is null then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'An email or phone number is required' using errcode = '22023';
  end if;
  if v_email is not null and not private.is_valid_email(v_email) then
    raise exception 'Invalid email address' using errcode = '22023';
  end if;
  if v_phone is not null and not private.is_valid_phone(v_phone) then
    raise exception 'Invalid phone number' using errcode = '22023';
  end if;
  if p_team_member_slug is not null and p_team_member_slug <> '' then
    if p_team_member_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$' then
      raise exception 'Unknown team member' using errcode = '22023';
    end if;
    select * into v_member from public.team_members
    where website_id = p_website_id and slug = p_team_member_slug and status = 'published';
    if not found then
      raise exception 'Unknown team member' using errcode = '22023';
    end if;
  end if;
  if p_service_slug is not null and p_service_slug <> '' then
    if p_service_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$' then
      raise exception 'Unknown service' using errcode = '22023';
    end if;
    select name into v_service_name from public.services
    where website_id = p_website_id and slug = p_service_slug and status = 'published';
    if not found then
      raise exception 'Unknown service' using errcode = '22023';
    end if;
  end if;
  perform private.assert_public_write_allowed(p_website_id, v_email, v_phone);
  select organization_id into v_org from public.websites where id = p_website_id;
  perform pg_advisory_xact_lock(hashtext('waitlist:' || p_website_id));
  select coalesce(max(position), 0) + 1 into v_position
  from public.waitlist_entries
  where website_id = p_website_id and status in ('waiting', 'called', 'in_chair')
    and joined_at > now() - interval '18 hours';
  v_minutes_per_client := coalesce((
    select (value ->> 'minutes_per_client')::integer from public.website_settings
    where website_id = p_website_id and key = 'waitlist'
  ), 30);
  v_ticket := private.generate_ticket_code(private.ticket_prefix(p_website_id));
  insert into public.waitlist_entries (
    website_id, organization_id, ticket_code, customer_name, customer_phone, customer_email,
    service_name, team_member_id, team_member_name, position, est_minutes
  ) values (
    p_website_id, v_org, v_ticket, v_name, v_phone, v_email,
    v_service_name, v_member.id, v_member.name, v_position, (v_position - 1) * v_minutes_per_client
  );
  return jsonb_build_object(
    'ticket_code', v_ticket, 'position', v_position,
    'est_minutes', (v_position - 1) * v_minutes_per_client, 'status', 'waiting'
  );
end;
$$;
