-- submit_form: every input checked before anything is stored (security hardening).
-- Same signature and answers as before; new refusals are 22023 with a short,
-- neutral message:
--   - website id format, form type enum (unchanged), feature (unchanged);
--   - name 120, email 254 (valid address), phone 40 (digits and + ( ) . -),
--     company 160, message 5000 (multi-line): cleaned, refused when too long
--     or when they hold HTML markup (they used to be cut silently);
--   - data: a JSON object of at most 16 KB as sent and 8 KB once cleaned,
--     100 keys, 5 levels, strings of 5000 characters without HTML;
--   - source: cleaned, one line, cut at 80 (not typed by the visitor).
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
as $$
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
  v_feature := case p_form_type
    when 'contact' then 'contact_form'
    when 'preview_request' then 'contact_form'
    when 'registration' then 'contact_form'
    when 'quote' then 'quotes'
    when 'vip_signup' then 'newsletter'
    when 'newsletter' then 'newsletter'
  end;
  if v_feature is null then
    raise exception 'Unknown form type' using errcode = '22023';
  end if;
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
$$;
