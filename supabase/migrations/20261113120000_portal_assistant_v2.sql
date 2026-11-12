-- Members' AI assistant, round 2.
--
-- * Images: a member can join an image to a question. The image is never
--   stored by LevelUp (the AI reads it once); only the count is kept, for a
--   daily allowance per level: portal_settings.assistant_images =
--   {base, plan 1, plan 2, plan 3}.
-- * "My project": a few words the member writes about their project
--   (portal_customers.member_note); the assistant reads it with the dossier.
-- * The member reads their own dossier (portal_profile_me) to see and
--   download it.

alter table public.portal_customers
  add column if not exists member_note text check (member_note is null or char_length(member_note) <= 2000);

alter table public.portal_settings
  add column if not exists assistant_images smallint[] not null default '{2,5,10,20}'
    check (cardinality(assistant_images) = 4 and 0 <= all (assistant_images) and 50 >= all (assistant_images));

alter table private.portal_ai_messages
  add column if not exists images smallint not null default 0 check (images between 0 and 3);

create or replace function private.portal_ai_images(p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'daily', coalesce(st.assistant_images[private.portal_customer_level(c.id) + 1], 0),
    'used', (select coalesce(sum(m.images), 0)::integer from private.portal_ai_messages m
             where m.customer_id = c.id and m.created_at > now() - interval '24 hours'))
  from public.portal_customers c
  left join public.portal_settings st on st.website_id = c.website_id
  where c.id = p_customer_id;
$$;
revoke all on function private.portal_ai_images(uuid) from public, anon, authenticated;

create or replace function public.portal_ai_thread(p_key text, p_session text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; st public.portal_settings;
begin
  c := private.portal_session(p_key, p_session);
  select * into st from public.portal_settings where website_id = c.website_id;
  return jsonb_build_object(
    'enabled', coalesce(st.assistant_enabled, false),
    'active', private.portal_member_active(c.id),
    'daily', coalesce(st.assistant_daily, 20),
    'used', private.portal_ai_used_today(c.id),
    'images', private.portal_ai_images(c.id),
    'has_profile', c.profile is not null or c.member_note is not null,
    'messages', coalesce((
      select jsonb_agg(private.portal_ai_json(x) || jsonb_build_object('images', x.images) order by x.created_at)
      from (select * from private.portal_ai_messages where customer_id = c.id
            order by created_at desc limit 60) x), '[]'::jsonb));
end;
$$;

drop function if exists public.portal_ai_begin(text, text, text);

-- Errors: PT402 membership ended, PT404 assistant off, PT429 daily questions,
-- PT431 daily images.
create or replace function public.portal_ai_begin(p_key text, p_session text, p_question text, p_images integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; st public.portal_settings; v_q text; q private.portal_ai_messages;
  v_offers text[]; v_site_name text; v_img jsonb;
begin
  c := private.portal_session(p_key, p_session);
  select * into st from public.portal_settings where website_id = c.website_id;
  if not coalesce(st.assistant_enabled, false) then
    raise exception 'Assistant off' using errcode = 'PT404';
  end if;
  if not private.portal_member_active(c.id) then
    raise exception 'Membership expired' using errcode = 'PT402';
  end if;
  v_q := private.check_text(p_question, 2000, 'question', true);
  if v_q is null or v_q = '' then
    raise exception 'Empty question' using errcode = '22023';
  end if;
  if p_images is null or p_images < 0 or p_images > 3 then
    raise exception 'Invalid images' using errcode = '22023';
  end if;
  if private.portal_ai_used_today(c.id) >= coalesce(st.assistant_daily, 20) then
    raise exception 'Daily limit' using errcode = 'PT429';
  end if;
  if p_images > 0 then
    v_img := private.portal_ai_images(c.id);
    if (v_img ->> 'used')::integer + p_images > (v_img ->> 'daily')::integer then
      raise exception 'Image limit' using errcode = 'PT431';
    end if;
  end if;
  if (select count(*) from private.portal_ai_messages
      where website_id = c.website_id and role = 'user' and created_at > now() - interval '24 hours') >= 3000 then
    raise exception 'Site limit' using errcode = 'PT429';
  end if;
  perform private.hit_rate_limit('portal_ai_minute', c.id::text, 6, interval '1 minute');

  insert into private.portal_ai_messages (website_id, organization_id, customer_id, role, body, images)
  values (c.website_id, c.organization_id, c.id, 'user', v_q, p_images)
  returning * into q;

  v_offers := private.portal_customer_offers(c.id);
  select coalesce(nullif(w.name, ''), w.id) into v_site_name from public.websites w where w.id = c.website_id;

  return jsonb_build_object(
    'question_id', q.id,
    'question', q.body,
    'images', p_images,
    'site', v_site_name,
    'today', now(),
    'member', jsonb_build_object(
      'name', c.name, 'locale', c.locale, 'member_since', c.created_at,
      'member_until', c.member_until, 'level', private.portal_customer_level(c.id)),
    'profile', c.profile,
    'member_note', c.member_note,
    'knowledge', coalesce((
      select jsonb_agg(jsonb_build_object('title', k.title, 'body', k.body) order by k.updated_at desc)
      from (select * from public.portal_knowledge
            where website_id = c.website_id and active order by updated_at desc limit 40) k), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('title', i.title, 'body', left(coalesce(i.body, ''), 800),
                                          'kind', i.kind, 'published_at', i.published_at)
                       order by i.published_at desc)
      from (select * from public.portal_items pi
            where pi.website_id = c.website_id and private.portal_item_visible(pi, c.id, v_offers)
            order by pi.published_at desc limit 15) i), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('from', m.sender, 'body', left(m.body, 800), 'at', m.created_at)
                       order by m.created_at)
      from (select * from public.portal_messages where customer_id = c.id
            order by created_at desc limit 12) m), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('role', h.role, 'body', left(h.body, 2000)) order by h.created_at)
      from (select * from private.portal_ai_messages where customer_id = c.id and id <> q.id
            order by created_at desc limit 10) h), '[]'::jsonb));
end;
$$;

-- The member's own dossier and note.
create or replace function public.portal_profile_me(p_key text, p_session text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  return jsonb_build_object('profile', c.profile, 'updated_at', c.profile_updated_at, 'note', c.member_note);
end;
$$;

create or replace function public.portal_profile_note(p_key text, p_session text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers; v_note text;
begin
  c := private.portal_session(p_key, p_session);
  v_note := private.check_text(p_note, 2000, 'note', true);
  perform private.hit_rate_limit('portal_profile_note', c.id::text, 30, interval '1 hour');
  update public.portal_customers set member_note = nullif(btrim(coalesce(v_note, '')), '') where id = c.id;
  return jsonb_build_object('ok', true, 'note', nullif(btrim(coalesce(v_note, '')), ''));
end;
$$;

-- Dashboard: image allowance per level, and the member's note.
create or replace function public.portal_admin_assistant(p_website_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.portal_settings;
begin
  perform private.portal_manage_site(p_website_id);
  select * into st from public.portal_settings where website_id = p_website_id;
  return jsonb_build_object(
    'enabled', coalesce(st.assistant_enabled, false),
    'daily', coalesce(st.assistant_daily, 20),
    'images', to_jsonb(coalesce(st.assistant_images, '{2,5,10,20}'::smallint[])),
    'questions_today', (select count(*) from private.portal_ai_messages
                        where website_id = p_website_id and role = 'user' and created_at > now() - interval '24 hours'),
    'questions_month', (select count(*) from private.portal_ai_messages
                        where website_id = p_website_id and role = 'user' and created_at > now() - interval '30 days'),
    'handoffs_open', (select count(*) from public.portal_messages m
                      where m.website_id = p_website_id and m.via = 'assistant'
                        and not exists (select 1 from public.portal_messages r where r.reply_to = m.id)),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'body', k.body, 'active', k.active,
                                          'updated_at', k.updated_at) order by k.updated_at desc)
      from public.portal_knowledge k where k.website_id = p_website_id), '[]'::jsonb));
end;
$$;

drop function if exists public.portal_admin_assistant_settings(text, boolean, integer);

create or replace function public.portal_admin_assistant_settings(
  p_website_id text, p_enabled boolean, p_daily integer, p_images integer[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := private.portal_manage_site(p_website_id);
  perform private.assert_org_unlocked(v_org);
  if p_enabled is null or p_daily is null or p_daily < 1 or p_daily > 200 then
    raise exception 'Invalid settings' using errcode = '22023';
  end if;
  if p_images is not null and (cardinality(p_images) <> 4 or 0 > any (p_images) or 50 < any (p_images)
                               or array_position(p_images, null) is not null) then
    raise exception 'Invalid image limits' using errcode = '22023';
  end if;
  insert into public.portal_settings (website_id, organization_id, assistant_enabled, assistant_daily, assistant_images, updated_by)
  values (p_website_id, v_org, p_enabled, p_daily, coalesce(p_images::smallint[], '{2,5,10,20}'), (select auth.uid()))
  on conflict (website_id) do update
    set assistant_enabled = excluded.assistant_enabled, assistant_daily = excluded.assistant_daily,
        assistant_images = coalesce(p_images::smallint[], public.portal_settings.assistant_images),
        updated_at = now(), updated_by = excluded.updated_by;
  perform private.site_audit(p_website_id, v_org, 'portal.assistant_settings', p_website_id,
    jsonb_build_object('enabled', p_enabled, 'daily', p_daily, 'images', p_images));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.portal_admin_profile(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  select * into c from public.portal_customers where id = p_customer_id;
  if c.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.portal_manage_site(c.website_id);
  return jsonb_build_object('profile', c.profile, 'updated_at', c.profile_updated_at, 'note', c.member_note);
end;
$$;

-- Account deletion also forgets the note.
do $patch$
declare
  v_def text;
  v_anchor text := 'update public.portal_customers set profile = null, profile_updated_at = null where id = c.id;';
begin
  v_def := pg_get_functiondef('public.portal_delete_account_finish(text,text)'::regprocedure);
  if position('member_note' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'anchor not found in portal_delete_account_finish';
  end if;
  execute replace(v_def, v_anchor,
    'update public.portal_customers set profile = null, profile_updated_at = null, member_note = null where id = c.id;');
end;
$patch$;

revoke all on function
  public.portal_ai_begin(text, text, text, integer),
  public.portal_profile_me(text, text),
  public.portal_profile_note(text, text, text),
  public.portal_admin_assistant_settings(text, boolean, integer, integer[])
from public;
grant execute on function
  public.portal_ai_begin(text, text, text, integer),
  public.portal_profile_me(text, text),
  public.portal_profile_note(text, text, text)
to anon, authenticated;
grant execute on function public.portal_admin_assistant_settings(text, boolean, integer, integer[]) to authenticated;
