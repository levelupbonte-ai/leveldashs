-- Input validation helpers shared by every public function (security hardening).
--
-- Same rules as the apps (dashboard src/lib/validation/sanitize.ts, showcase
-- src/lib/input.ts): text is cleaned of control characters, invisible /
-- direction-override characters and the Unicode tag block, line breaks are
-- normalised, whitespace is tidied; then every field is checked against a
-- maximum length and refused (22023, a short neutral message) instead of being
-- silently cut. Formats: e-mail, phone, http(s) link, HTML markup in plain text.

-- Multi-line text: control and invisible characters removed, CR/LF normalised,
-- at most one blank line in a row, trimmed, cut at p_max (null when empty).
-- Kept backward compatible (same signature, still truncates): existing callers
-- now also lose zero-width and bidi characters.
create or replace function private.clean_text(p_value text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            replace(replace(coalesce(p_value, ''), E'\r\n', E'\n'), E'\r', E'\n'),
            '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]', '', 'g'),
          '[\x00AD\x180E\x200B\x200E\x200F\x202A-\x202E\x2060-\x2064\x2066-\x2069\xFEFF\xE0000-\xE007F]', '', 'g'),
        E'\n{3,}', E'\n\n', 'g'),
      '^[[:space:]]+|[[:space:]]+$', '', 'g'),
    p_max), '');
$$;

-- One line of text: clean_text, then every whitespace run (line breaks, tabs)
-- becomes one space.
create or replace function private.clean_line(p_value text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(regexp_replace(
    coalesce(private.clean_text(p_value, 100000), ''), '[[:space:]]+', ' ', 'g')), p_max), '');
$$;

-- HTML tags or comments in a plain-text value (a < b, <3 and x<5 are not tags).
create or replace function private.has_markup(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_value ~* '<\/?[a-z][a-z0-9-]*([[:space:]/][^>]*)?>|<!--|<!\[CDATA\[|<\?[a-z]', false);
$$;

-- A user-typed field: cleaned (one line unless p_multiline), refused when longer
-- than p_max or when it holds HTML markup. Null when empty.
create or replace function private.check_text(
  p_value text,
  p_max integer,
  p_field text,
  p_multiline boolean default false
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_value is null then
    return null;
  end if;
  -- Grossly oversized input is refused before any regular expression runs.
  if octet_length(p_value) > greatest(p_max, 1) * 8 + 1024 then
    raise exception 'Too long: % (max % characters)', p_field, p_max using errcode = '22023';
  end if;
  v := case when p_multiline then private.clean_text(p_value, 100000) else private.clean_line(p_value, 100000) end;
  if char_length(v) > p_max then
    raise exception 'Too long: % (max % characters)', p_field, p_max using errcode = '22023';
  end if;
  if private.has_markup(v) then
    raise exception 'HTML is not allowed: %', p_field using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Practical e-mail address (no quotes or comments, a dotted domain, a letter TLD).
create or replace function private.is_valid_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_email is not null
    and char_length(p_email) between 6 and 254
    and position('..' in p_email) = 0
    and p_email ~ '^[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$'
    and p_email !~ '^\.|\.@';
$$;

-- Digits, spaces and + ( ) . - only, 6 to 20 digits.
create or replace function private.is_valid_phone(p_phone text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_phone is not null
    and p_phone ~ '^\+?[0-9 ().-]{6,40}$'
    and char_length(regexp_replace(p_phone, '[^0-9]', '', 'g')) between 6 and 20;
$$;

-- http(s) link with a dotted host, no credentials, no whitespace, quotes or
-- angle brackets. A bare domain (example.com/page) is read as https://.
-- Returns the normalised link, or null when it is not a safe link.
create or replace function private.safe_url(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  with v as (
    select case
      when p_value is null or btrim(p_value) = '' then null
      when p_value ~* '^[a-z][a-z0-9+.-]*:' then btrim(p_value)
      when p_value ~ '^/' then null
      else 'https://' || btrim(p_value)
    end as u
  )
  select case
    when u is not null and char_length(u) <= 2048
     and u ~* '^https?://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:[0-9]{1,5})?([/?#][^[:space:]<>"\x27\x60\\]*)?$'
    then u
  end
  from v;
$$;

-- A user-typed link field: cleaned, normalised, refused when not an http(s)
-- link or longer than p_max. Null when empty.
create or replace function private.check_url(p_value text, p_max integer, p_field text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := private.check_text(p_value, p_max, p_field);
  u text;
begin
  if v is null then
    return null;
  end if;
  u := private.safe_url(v);
  if u is null or char_length(u) > p_max then
    raise exception 'Invalid link: %', p_field using errcode = '22023';
  end if;
  return u;
end;
$$;

-- Links typed in a list (social profiles, links quoted in a description): each
-- item is cleaned and kept only when it is a safe http(s) link or an @handle;
-- anything else is dropped. At most p_items items of p_len characters.
create or replace function private.clean_link_array(p_value jsonb, p_items integer, p_len integer)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(v order by o), '{}')
  from (
    select coalesce(private.safe_url(c), case when c ~ '^@[A-Za-z0-9._-]{1,60}$' then c end) as v, o
    from (
      select private.clean_line(e.value, p_len) as c, e.o
      from jsonb_array_elements_text(
        case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end
      ) with ordinality as e(value, o)
      where e.o <= p_items
    ) x
  ) y
  where v is not null and char_length(v) <= p_len;
$$;

-- Free-form JSON typed by visitors (form extras, project brief): strings
-- cleaned (multi-line, max 5000 characters, no HTML), keys cleaned (one line,
-- 1 to 60 characters, no prototype keys), at most 100 keys per object, 100
-- items per array and 5 levels. Anything else is refused with 22023.
create or replace function private.clean_jsonb(p_value jsonb, p_depth integer default 0)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb;
  v_key text;
  v_clean_key text;
  v_val jsonb;
  n integer := 0;
begin
  if p_value is null then
    return null;
  end if;
  case jsonb_typeof(p_value)
    when 'string' then
      return to_jsonb(coalesce(private.check_text(p_value #>> '{}', 5000, 'field', true), ''));
    when 'number', 'boolean', 'null' then
      return p_value;
    when 'array' then
      if p_depth >= 5 or jsonb_array_length(p_value) > 100 then
        raise exception 'Invalid data' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(private.clean_jsonb(e.value, p_depth + 1) order by e.o), '[]'::jsonb)
      into v_out
      from jsonb_array_elements(p_value) with ordinality as e(value, o);
      return v_out;
    else
      if p_depth >= 5 then
        raise exception 'Invalid data' using errcode = '22023';
      end if;
      v_out := '{}'::jsonb;
      for v_key, v_val in select j.key, j.value from jsonb_each(p_value) as j loop
        n := n + 1;
        if n > 100 then
          raise exception 'Too many fields' using errcode = '22023';
        end if;
        v_clean_key := private.clean_line(v_key, 61);
        if v_clean_key is null or char_length(v_clean_key) > 60
           or v_clean_key in ('__proto__', 'constructor', 'prototype')
           or private.has_markup(v_clean_key) then
          raise exception 'Invalid field name' using errcode = '22023';
        end if;
        v_out := v_out || jsonb_build_object(v_clean_key, private.clean_jsonb(v_val, p_depth + 1));
      end loop;
      return v_out;
  end case;
end;
$$;

revoke all on function private.clean_line(text, integer) from public, anon, authenticated;
revoke all on function private.has_markup(text) from public, anon, authenticated;
revoke all on function private.check_text(text, integer, text, boolean) from public, anon, authenticated;
revoke all on function private.is_valid_phone(text) from public, anon, authenticated;
revoke all on function private.safe_url(text) from public, anon, authenticated;
revoke all on function private.check_url(text, integer, text) from public, anon, authenticated;
revoke all on function private.clean_link_array(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function private.clean_jsonb(jsonb, integer) from public, anon, authenticated;
