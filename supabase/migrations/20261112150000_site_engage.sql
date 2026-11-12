-- Engage: features every website gets from the dashboard, without code changes.
--
-- * Campaigns: announcement bar, pop-up (with an optional coupon and
--   countdown) or an inline card in a slot the site exposes
--   (<div data-lu-campaign="name">). The LevelUp tag shows them; they ride in
--   the cached site bundle (no extra request per visitor). Content is text
--   only (the tag sets textContent), links are https only.
-- * Remote settings: key / value pairs the site reads (the tag:
--   LevelUp.config(); a site server: the bundle). Public by design: never a
--   secret.
-- * Promo codes: checked by the site's server before the payment page
--   (site_promo_check, server key with the payments scope), counted when the
--   payment arrives (site_payments trigger), limited by dates, uses and offers.
--
-- Dashboard writes: editors and above, audited in site_audit_log.

-- ------------------------------------------------------------ helper

create or replace function private.engage_site(p_website_id text, p_min_role text default 'editor')
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select w.organization_id into v_org from public.websites w where w.id = p_website_id;
  if v_org is null or not private.has_org_role(v_org, p_min_role) then
    raise exception 'Not allowed' using errcode = 'PT403';
  end if;
  return v_org;
end;
$$;
revoke all on function private.engage_site(text, text) from public, anon, authenticated;

-- ------------------------------------------------------------ campaigns

create table if not exists public.site_campaigns (
  id uuid primary key default gen_random_uuid(),
  website_id text not null references public.websites (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('bar', 'popup', 'slot')),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 6000),
  cta_url text check (cta_url is null or (char_length(cta_url) between 11 and 500 and cta_url ~ '^https://[^\s<>"]+$')),
  coupon_code text check (coupon_code is null or coupon_code ~ '^[A-Za-z0-9_-]{2,32}$'),
  countdown_to timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  pages text[] not null default '{}' check (cardinality(pages) <= 20),
  slot text check (slot is null or slot ~ '^[a-z0-9-]{1,40}$'),
  position text not null default 'bottom' check (position in ('top', 'bottom')),
  delay_seconds smallint not null default 3 check (delay_seconds between 0 and 120),
  frequency text not null default 'session' check (frequency in ('always', 'session', 'once')),
  theme text not null default 'dark' check (theme in ('dark', 'light', 'accent')),
  accent text check (accent is null or accent ~ '^#[0-9a-fA-F]{6}$'),
  priority smallint not null default 0 check (priority between 0 and 100),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (kind <> 'slot' or slot is not null)
);
create index if not exists site_campaigns_site_idx on public.site_campaigns (website_id, status);
alter table public.site_campaigns enable row level security;
revoke all on public.site_campaigns from public, anon, authenticated;
grant select on public.site_campaigns to authenticated;
drop policy if exists site_campaigns_member_read on public.site_campaigns;
create policy site_campaigns_member_read on public.site_campaigns
  for select to authenticated using (private.has_org_role(organization_id, 'viewer'));

create table if not exists public.site_campaign_stats (
  campaign_id uuid not null references public.site_campaigns (id) on delete cascade,
  day date not null,
  views integer not null default 0,
  clicks integer not null default 0,
  closes integer not null default 0,
  primary key (campaign_id, day)
);
alter table public.site_campaign_stats enable row level security;
revoke all on public.site_campaign_stats from public, anon, authenticated;

-- Content: { "fr": { "title", "text", "cta" }, "en": { … } }, text only, bounded.
create or replace function private.campaign_content(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := '{}'::jsonb; l text; t text; x text; c text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid campaign: content' using errcode = '22023';
  end if;
  foreach l in array array['fr', 'en'] loop
    if p ? l and jsonb_typeof(p -> l) = 'object' then
      t := private.check_text(p -> l ->> 'title', 80, 'title');
      x := private.check_text(p -> l ->> 'text', 300, 'text', true);
      c := private.check_text(p -> l ->> 'cta', 40, 'cta');
      if t is not null or x is not null then
        v := v || jsonb_build_object(l, jsonb_strip_nulls(jsonb_build_object('title', t, 'text', x, 'cta', c)));
      end if;
    end if;
  end loop;
  if v = '{}'::jsonb then
    raise exception 'Invalid campaign: a title or a text is required' using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke all on function private.campaign_content(jsonb) from public, anon, authenticated;

create or replace function public.site_campaigns_list(p_website_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := private.engage_site(p_website_id, 'viewer');
  return coalesce((
    select jsonb_agg(to_jsonb(c) - array['organization_id', 'created_by', 'updated_by']
                     || jsonb_build_object('stats', (
                          select jsonb_build_object('views', coalesce(sum(s.views), 0), 'clicks', coalesce(sum(s.clicks), 0),
                                                    'closes', coalesce(sum(s.closes), 0))
                          from public.site_campaign_stats s
                          where s.campaign_id = c.id and s.day > current_date - 30))
                     order by (c.status = 'active') desc, c.priority desc, c.updated_at desc)
    from public.site_campaigns c
    where c.website_id = p_website_id and c.status <> 'archived'), '[]'::jsonb);
end;
$$;
revoke all on function public.site_campaigns_list(text) from public, anon;
grant execute on function public.site_campaigns_list(text) to authenticated;

create or replace function public.site_campaign_save(p_website_id text, p_id uuid, p_campaign jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_id uuid; v_kind text; v_pages text[] := '{}'; v_page text; v_url text; v_name text;
  c jsonb := p_campaign;
begin
  v_org := private.engage_site(p_website_id, 'editor');
  if c is null or jsonb_typeof(c) <> 'object' then
    raise exception 'Invalid campaign' using errcode = '22023';
  end if;
  v_name := private.check_text(c ->> 'name', 80, 'name');
  v_kind := c ->> 'kind';
  if v_name is null or v_kind not in ('bar', 'popup', 'slot') then
    raise exception 'Invalid campaign' using errcode = '22023';
  end if;
  v_url := nullif(btrim(coalesce(c ->> 'cta_url', '')), '');
  if v_url is not null and (char_length(v_url) > 500 or v_url !~ '^https://[^\s<>"]{3,}$') then
    raise exception 'Invalid campaign: link' using errcode = '22023';
  end if;
  if jsonb_typeof(c -> 'pages') = 'array' then
    for v_page in select jsonb_array_elements_text(c -> 'pages') loop
      v_page := btrim(v_page);
      if v_page <> '' then
        if v_page !~ '^/[^\s<>"]{0,200}$' then
          raise exception 'Invalid campaign: page' using errcode = '22023';
        end if;
        v_pages := v_pages || v_page;
      end if;
    end loop;
  end if;
  if p_id is null then
    insert into public.site_campaigns (website_id, organization_id, name, kind, created_by)
    values (p_website_id, v_org, v_name, v_kind, (select auth.uid()))
    returning id into v_id;
  else
    select id into v_id from public.site_campaigns where id = p_id and website_id = p_website_id;
    if v_id is null then
      raise exception 'Unknown campaign' using errcode = 'PT404';
    end if;
  end if;
  update public.site_campaigns set
    name = v_name,
    kind = v_kind,
    content = private.campaign_content(c -> 'content'),
    cta_url = v_url,
    coupon_code = nullif(btrim(coalesce(c ->> 'coupon_code', '')), ''),
    countdown_to = nullif(c ->> 'countdown_to', '')::timestamptz,
    starts_at = nullif(c ->> 'starts_at', '')::timestamptz,
    ends_at = nullif(c ->> 'ends_at', '')::timestamptz,
    pages = v_pages,
    slot = nullif(btrim(coalesce(c ->> 'slot', '')), ''),
    position = coalesce(nullif(c ->> 'position', ''), 'bottom'),
    delay_seconds = coalesce((c ->> 'delay_seconds')::smallint, 3),
    frequency = coalesce(nullif(c ->> 'frequency', ''), 'session'),
    theme = coalesce(nullif(c ->> 'theme', ''), 'dark'),
    accent = nullif(c ->> 'accent', ''),
    priority = coalesce((c ->> 'priority')::smallint, 0),
    status = case when c ->> 'status' in ('draft', 'active', 'paused') then c ->> 'status' else status end,
    updated_by = (select auth.uid()),
    updated_at = now()
  where id = v_id;
  perform private.site_audit(p_website_id, v_org, case when p_id is null then 'campaign.created' else 'campaign.updated' end,
    v_id::text, jsonb_build_object('label', v_name, 'kind', v_kind));
  return v_id;
exception
  when invalid_datetime_format or invalid_text_representation or check_violation then
    raise exception 'Invalid campaign' using errcode = '22023';
end;
$$;
revoke all on function public.site_campaign_save(text, uuid, jsonb) from public, anon;
grant execute on function public.site_campaign_save(text, uuid, jsonb) to authenticated;

create or replace function public.site_campaign_set_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.site_campaigns; v_org uuid;
begin
  select * into c from public.site_campaigns where id = p_id;
  if c.id is null then
    raise exception 'Unknown campaign' using errcode = 'PT404';
  end if;
  v_org := private.engage_site(c.website_id, 'editor');
  if p_status not in ('draft', 'active', 'paused', 'archived') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  update public.site_campaigns set status = p_status, updated_by = (select auth.uid()), updated_at = now() where id = p_id;
  perform private.site_audit(c.website_id, v_org, 'campaign.' || p_status, p_id::text, jsonb_build_object('label', c.name));
end;
$$;
revoke all on function public.site_campaign_set_status(uuid, text) from public, anon;
grant execute on function public.site_campaign_set_status(uuid, text) to authenticated;

-- The tag reports a view, a click or a close (daily counters only; nothing about the visitor).
create or replace function public.track_campaign_event(p_website_id text, p_campaign_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('view', 'click', 'close') then
    return;
  end if;
  if not exists (select 1 from public.site_campaigns c
                 where c.id = p_campaign_id and c.website_id = p_website_id and c.status = 'active') then
    return;
  end if;
  insert into public.site_campaign_stats as s (campaign_id, day, views, clicks, closes)
  values (p_campaign_id, current_date, (p_kind = 'view')::int, (p_kind = 'click')::int, (p_kind = 'close')::int)
  on conflict (campaign_id, day) do update
    set views = s.views + excluded.views, clicks = s.clicks + excluded.clicks, closes = s.closes + excluded.closes;
end;
$$;
revoke all on function public.track_campaign_event(text, uuid, text) from public;
grant execute on function public.track_campaign_event(text, uuid, text) to anon, authenticated;

-- ------------------------------------------------------------ remote settings

create table if not exists public.site_config_values (
  website_id text not null references public.websites (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_.]{0,63}$'),
  kind text not null check (kind in ('text', 'number', 'boolean', 'date', 'json')),
  value jsonb not null check (pg_column_size(value) <= 4000),
  description text check (char_length(description) <= 200),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (website_id, key)
);
alter table public.site_config_values enable row level security;
revoke all on public.site_config_values from public, anon, authenticated;
grant select on public.site_config_values to authenticated;
drop policy if exists site_config_member_read on public.site_config_values;
create policy site_config_member_read on public.site_config_values
  for select to authenticated using (private.has_org_role(organization_id, 'viewer'));

create or replace function public.site_config_set(p_website_id text, p_key text, p_kind text, p_value jsonb, p_description text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v jsonb := p_value;
begin
  v_org := private.engage_site(p_website_id, 'editor');
  if p_key is null or p_key !~ '^[a-z][a-z0-9_.]{0,63}$' or p_kind not in ('text', 'number', 'boolean', 'date', 'json') or v is null then
    raise exception 'Invalid setting' using errcode = '22023';
  end if;
  if (p_kind = 'text' and (jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 2000))
     or (p_kind = 'number' and jsonb_typeof(v) <> 'number')
     or (p_kind = 'boolean' and jsonb_typeof(v) <> 'boolean')
     or (p_kind = 'date' and (jsonb_typeof(v) <> 'string' or (v #>> '{}')::timestamptz is null))
     or (p_kind = 'json' and jsonb_typeof(v) not in ('object', 'array')) then
    raise exception 'Invalid setting: value' using errcode = '22023';
  end if;
  if p_kind = 'text' then
    v := to_jsonb(private.check_text(v #>> '{}', 2000, 'value', true));
  elsif p_kind = 'json' then
    v := private.clean_jsonb(v);
  elsif p_kind = 'date' then
    v := to_jsonb((v #>> '{}')::timestamptz);
  end if;
  if pg_column_size(v) > 4000 then
    raise exception 'Invalid setting: too large' using errcode = '22023';
  end if;
  insert into public.site_config_values (website_id, organization_id, key, kind, value, description, updated_by)
  values (p_website_id, v_org, p_key, p_kind, v, private.check_text(p_description, 200, 'description'), (select auth.uid()))
  on conflict (website_id, key) do update
    set kind = excluded.kind, value = excluded.value, description = excluded.description,
        updated_by = excluded.updated_by, updated_at = now();
  perform private.site_audit(p_website_id, v_org, 'config.set', p_key, jsonb_build_object('label', p_key));
exception
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Invalid setting: date' using errcode = '22023';
end;
$$;
revoke all on function public.site_config_set(text, text, text, jsonb, text) from public, anon;
grant execute on function public.site_config_set(text, text, text, jsonb, text) to authenticated;

create or replace function public.site_config_delete(p_website_id text, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := private.engage_site(p_website_id, 'editor');
  delete from public.site_config_values where website_id = p_website_id and key = p_key;
  perform private.site_audit(p_website_id, v_org, 'config.deleted', p_key, jsonb_build_object('label', p_key));
end;
$$;
revoke all on function public.site_config_delete(text, text) from public, anon;
grant execute on function public.site_config_delete(text, text) to authenticated;

-- ------------------------------------------------------------ promo codes

create table if not exists public.site_promo_codes (
  id uuid primary key default gen_random_uuid(),
  website_id text not null references public.websites (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_-]{3,32}$'),
  description text check (char_length(description) <= 160),
  discount_kind text not null check (discount_kind in ('percent', 'amount')),
  discount_value integer not null check (discount_value > 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  offers text[] not null default '{}' check (cardinality(offers) <= 30),
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, code),
  check (discount_kind <> 'percent' or discount_value <= 100)
);
alter table public.site_promo_codes enable row level security;
revoke all on public.site_promo_codes from public, anon, authenticated;
grant select on public.site_promo_codes to authenticated;
drop policy if exists site_promo_member_read on public.site_promo_codes;
create policy site_promo_member_read on public.site_promo_codes
  for select to authenticated using (private.has_org_role(organization_id, 'viewer'));

create table if not exists public.site_promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.site_promo_codes (id) on delete cascade,
  website_id text not null,
  payment_id uuid unique references public.site_payments (id) on delete set null,
  amount_off bigint,
  created_at timestamptz not null default now()
);
create index if not exists site_promo_redemptions_code_idx on public.site_promo_redemptions (code_id, created_at desc);
alter table public.site_promo_redemptions enable row level security;
revoke all on public.site_promo_redemptions from public, anon, authenticated;

create or replace function public.site_promo_list(p_website_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.engage_site(p_website_id, 'viewer');
  return coalesce((
    select jsonb_agg(to_jsonb(p) - array['organization_id', 'created_by'] order by p.active desc, p.created_at desc)
    from public.site_promo_codes p where p.website_id = p_website_id), '[]'::jsonb);
end;
$$;
revoke all on function public.site_promo_list(text) from public, anon;
grant execute on function public.site_promo_list(text) to authenticated;

create or replace function public.site_promo_save(p_website_id text, p_id uuid, p_promo jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_id uuid; v_code text; v_kind text; v_value integer; v_offers text[] := '{}'; v_offer text;
  p jsonb := p_promo;
begin
  v_org := private.engage_site(p_website_id, 'editor');
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid code' using errcode = '22023';
  end if;
  v_code := upper(btrim(coalesce(p ->> 'code', '')));
  v_kind := p ->> 'discount_kind';
  v_value := (p ->> 'discount_value')::integer;
  if v_code !~ '^[A-Z0-9_-]{3,32}$' or v_kind not in ('percent', 'amount') or v_value is null or v_value <= 0
     or (v_kind = 'percent' and v_value > 100) or (v_kind = 'amount' and v_value > 10000000) then
    raise exception 'Invalid code' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'offers') = 'array' then
    for v_offer in select jsonb_array_elements_text(p -> 'offers') loop
      if v_offer !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$' then
        raise exception 'Invalid code: offer' using errcode = '22023';
      end if;
      v_offers := v_offers || v_offer;
    end loop;
  end if;
  if p_id is null then
    insert into public.site_promo_codes (website_id, organization_id, code, discount_kind, discount_value, created_by)
    values (p_website_id, v_org, v_code, v_kind, v_value, (select auth.uid()))
    returning id into v_id;
  else
    select id into v_id from public.site_promo_codes where id = p_id and website_id = p_website_id;
    if v_id is null then
      raise exception 'Unknown code' using errcode = 'PT404';
    end if;
  end if;
  update public.site_promo_codes set
    code = v_code,
    description = private.check_text(p ->> 'description', 160, 'description'),
    discount_kind = v_kind,
    discount_value = v_value,
    currency = coalesce(nullif(lower(p ->> 'currency'), ''), 'usd'),
    offers = v_offers,
    max_uses = nullif(p ->> 'max_uses', '')::integer,
    starts_at = nullif(p ->> 'starts_at', '')::timestamptz,
    ends_at = nullif(p ->> 'ends_at', '')::timestamptz,
    active = coalesce((p ->> 'active')::boolean, true),
    updated_at = now()
  where id = v_id;
  perform private.site_audit(p_website_id, v_org, case when p_id is null then 'promo.created' else 'promo.updated' end,
    v_id::text, jsonb_build_object('label', v_code));
  return v_id;
exception
  when unique_violation then
    raise exception 'This code already exists' using errcode = 'PT409';
  when invalid_datetime_format or invalid_text_representation or check_violation then
    raise exception 'Invalid code' using errcode = '22023';
end;
$$;
revoke all on function public.site_promo_save(text, uuid, jsonb) from public, anon;
grant execute on function public.site_promo_save(text, uuid, jsonb) to authenticated;

-- The site's server checks a code before opening the payment page (nothing is
-- consumed here). p_client: a hash of the visitor, for the guessing limit.
create or replace function public.site_promo_check(p_key text, p_code text, p_offer_id text, p_amount bigint, p_currency text, p_client text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text; p public.site_promo_codes; v_off bigint; v_final bigint; v_code text := upper(btrim(coalesce(p_code, '')));
begin
  select k.website_id into v_site from private.site_key_website(p_key, 'payments:write') k;
  if v_site is null then
    raise exception 'Not allowed' using errcode = 'PT403';
  end if;
  perform private.hit_rate_limit('promo_check', v_site, 3000, interval '1 hour');
  if coalesce(p_client, '') <> '' then
    perform private.hit_rate_limit('promo_check_client', v_site || ':' || left(p_client, 64), 20, interval '1 hour');
  end if;
  if v_code !~ '^[A-Z0-9_-]{3,32}$' or p_amount is null or p_amount < 1 then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into p from public.site_promo_codes where website_id = v_site and code = v_code;
  if p.id is null or not p.active then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if (p.starts_at is not null and p.starts_at > now()) or (p.ends_at is not null and p.ends_at <= now()) then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if p.max_uses is not null and p.uses >= p.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'used_up');
  end if;
  if cardinality(p.offers) > 0 and not (coalesce(p_offer_id, '') = any (p.offers)) then
    return jsonb_build_object('ok', false, 'reason', 'not_applicable');
  end if;
  if p.discount_kind = 'amount' and p.currency <> lower(coalesce(p_currency, 'usd')) then
    return jsonb_build_object('ok', false, 'reason', 'not_applicable');
  end if;
  v_off := case when p.discount_kind = 'percent' then round(p_amount * p.discount_value / 100.0) else p.discount_value end;
  -- Card payments need at least 0.50: a larger discount stops there.
  v_final := greatest(p_amount - v_off, least(p_amount, 50));
  return jsonb_build_object('ok', true, 'code_id', p.id, 'code', p.code, 'amount_off', p_amount - v_final,
                            'final_amount', v_final, 'label', p.description);
end;
$$;
revoke all on function public.site_promo_check(text, text, text, bigint, text, text) from public;
grant execute on function public.site_promo_check(text, text, text, bigint, text, text) to anon, authenticated;

-- A paid payment that used a code (metadata.promo_code_id set by the site's server) is counted once.
create or replace function private.site_promo_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code uuid;
begin
  if new.status <> 'paid' or (tg_op = 'UPDATE' and old.status = 'paid') then
    return new;
  end if;
  if coalesce(new.metadata ->> 'promo_code_id', '') !~ '^[0-9a-f-]{36}$' then
    return new;
  end if;
  select id into v_code from public.site_promo_codes
  where id = (new.metadata ->> 'promo_code_id')::uuid and website_id = new.website_id;
  if v_code is null then
    return new;
  end if;
  insert into public.site_promo_redemptions (code_id, website_id, payment_id, amount_off)
  values (v_code, new.website_id, new.id,
          case when new.metadata ->> 'amount_off' ~ '^[0-9]{1,12}$' then (new.metadata ->> 'amount_off')::bigint end)
  on conflict (payment_id) do nothing;
  if found then
    update public.site_promo_codes set uses = uses + 1, updated_at = now() where id = v_code;
  end if;
  return new;
end;
$$;
revoke all on function private.site_promo_from_payment() from public, anon, authenticated;
drop trigger if exists site_payments_promo on public.site_payments;
create trigger site_payments_promo
  after insert or update of status on public.site_payments
  for each row execute function private.site_promo_from_payment();

-- ------------------------------------------------------------ bundle

do $do$
declare
  d text := pg_get_functiondef('public.get_site_bundle(text)'::regprocedure);
  anchor text := $a$'generated_at', now(),$a$;
begin
  if position('site_campaigns' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'get_site_bundle: unexpected body, not patched';
  end if;
  execute replace(d, anchor, anchor || $ins$
    'campaigns', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'kind', c.kind, 'content', c.content, 'cta_url', c.cta_url, 'coupon_code', c.coupon_code,
               'countdown_to', c.countdown_to, 'starts_at', c.starts_at, 'ends_at', c.ends_at, 'pages', to_jsonb(c.pages),
               'slot', c.slot, 'position', c.position, 'delay_seconds', c.delay_seconds, 'frequency', c.frequency,
               'theme', c.theme, 'accent', c.accent, 'priority', c.priority)
             ORDER BY c.priority DESC, c.updated_at DESC)
      FROM (SELECT * FROM public.site_campaigns
            WHERE website_id = p_website_id AND status = 'active'
              AND (ends_at IS NULL OR ends_at > now())
              AND (starts_at IS NULL OR starts_at < now() + interval '1 day')
            ORDER BY priority DESC, updated_at DESC LIMIT 20) c
    ), '[]'::jsonb),
    'config', coalesce((
      SELECT jsonb_object_agg(v.key, v.value) FROM public.site_config_values v WHERE v.website_id = p_website_id
    ), '{}'::jsonb),$ins$);
end;
$do$;
