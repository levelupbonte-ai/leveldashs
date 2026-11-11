-- LevelUp Forms, lot 3: a form shown inside the client's own website (iframe
-- through forms/embed.js or the LevelUp tag). Only the sites the client allows
-- may frame it: settings.embed_origins, or by default the website's allowed
-- origins and its primary domain (with and without www).

create or replace function private.form_clean_origins(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text[] := '{}';
  o jsonb;
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 10 then
    raise exception 'up to 10 websites' using errcode = '22023';
  end if;
  for o in select * from jsonb_array_elements(p_value) loop
    v := lower(rtrim(btrim(coalesce(o #>> '{}', '')), '/'));
    if v = '' then
      continue;
    end if;
    if v !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{2,5})?$' then
      raise exception 'invalid website address' using errcode = '22023', hint = left(v, 80);
    end if;
    if not (v = any (v_out)) then
      v_out := v_out || v;
    end if;
  end loop;
  return case when cardinality(v_out) = 0 then null else to_jsonb(v_out) end;
end;
$$;

-- settings.embed_origins: up to 10 https origins (validated, lower case).
do $do$
declare
  d text := pg_get_functiondef('private.form_clean_settings(jsonb)'::regprocedure);
  anchor text := $a$    'show_logo', case when jsonb_typeof(s -> 'show_logo') = 'boolean' then (s -> 'show_logo') end$a$;
begin
  if position('embed_origins' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'form_clean_settings: unexpected body, not patched';
  end if;
  d := replace(d, anchor, $ins$    'embed_origins', private.form_clean_origins(s -> 'embed_origins'),
$ins$ || anchor);
  execute d;
end;
$do$;

-- The origins allowed to frame a published form (anon: the dashboard's edge
-- proxy reads it to set frame-ancestors). Empty for unknown or draft forms.
create or replace function public.public_form_embed_origins(p_public_id text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select array_agg(e) from jsonb_array_elements_text(f.settings -> 'embed_origins') e),
    (select array(
       select distinct x from unnest(
         coalesce(w.allowed_origins, '{}')
         || case when w.primary_domain ~ '^[a-z0-9.-]+$'
                 then array['https://' || w.primary_domain, 'https://www.' || regexp_replace(w.primary_domain, '^www\.', '')]
                 else '{}'::text[] end) x
       where x ~ '^https://'))
  )
  from public.site_forms f join public.websites w on w.id = f.website_id
  where f.public_id = p_public_id and f.status = 'published' and private.is_website_live(f.website_id);
$$;
revoke all on function public.public_form_embed_origins(text) from public;
grant execute on function public.public_form_embed_origins(text) to anon, authenticated;
