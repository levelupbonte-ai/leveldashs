-- Live site updates: when a website's public content changes, the database
-- pings that site's /api/revalidate endpoint (pg_net, after commit) so cached
-- pages (Next.js ISR) pick up the edit within seconds.
--
-- Hooks live in a private table; each hook's shared secret lives in Supabase
-- Vault (vault.secrets, by name) and is never readable by anon/authenticated.
-- One ping per website per transaction, so bulk edits send a single request.

create extension if not exists pg_net with schema extensions;

create table if not exists private.site_revalidate_hooks (
  website_id text primary key references public.websites (id) on delete cascade,
  url text not null check (url ~ '^https://[a-z0-9.-]+/api/revalidate$'),
  secret_name text not null
);
revoke all on private.site_revalidate_hooks from public, anon, authenticated;

create or replace function private.ping_site_revalidate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws text;
  v_hook private.site_revalidate_hooks;
  v_secret text;
begin
  v_ws := to_jsonb(coalesce(new, old)) ->> tg_argv[0];
  if v_ws is null or v_ws !~ '^ws_[a-z0-9]{8,32}$' then
    return null;
  end if;
  if current_setting('levelup.revalidated_' || v_ws, true) = '1' then
    return null;
  end if;

  select * into v_hook from private.site_revalidate_hooks where website_id = v_ws;
  if not found then
    return null;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = v_hook.secret_name;
  if v_secret is null then
    return null;
  end if;

  perform set_config('levelup.revalidated_' || v_ws, '1', true);
  perform net.http_post(
    url := v_hook.url,
    body := jsonb_build_object('website_id', v_ws),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-revalidate-secret', v_secret),
    timeout_milliseconds := 5000
  );
  return null;
exception when others then
  -- A failed ping must never block an edit; the 5-minute cache still expires.
  return null;
end;
$$;
revoke all on function private.ping_site_revalidate() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['content_blocks', 'services', 'faq_items', 'reviews', 'website_settings',
                           'team_members', 'gallery_items', 'announcements'] loop
    execute format('create or replace trigger revalidate_site after insert or update or delete on public.%I
                    for each row execute function private.ping_site_revalidate(%L)', t, 'website_id');
  end loop;
end $$;

create or replace trigger revalidate_site after update on public.websites
  for each row execute function private.ping_site_revalidate('id');
