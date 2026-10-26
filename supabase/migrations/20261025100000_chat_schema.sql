-- Chat: per-organization messaging in the dashboard (see docs/chat.md).
--
--   chat_conversations  team (one per organization, every member), direct (1:1
--                       between two members of the same organization) and
--                       visitor (messages people send from the website)
--   chat_participants   per-user state: last_read_at, muted (team / visitor rows
--                       are created on first read; direct rows when it opens)
--   chat_messages       body encrypted at the column level (pgcrypto, AES-256,
--                       key kept in Supabase Vault); soft delete wipes the body
--   chat_visitors       contact details of a visitor conversation (RPC only)
--
-- Access is real membership only (organization_members): LevelUp platform admins
-- do not read client chats unless they are members. Clients only SELECT (RLS, for
-- Realtime); every write goes through the SECURITY DEFINER functions of the next
-- migrations.

-- Feature switch for the public send_site_message RPC (future chat widget).
-- Off for every website until LevelUp enables it.
insert into public.features (key, name, description, is_active, sort_order)
values ('site_chat', 'Site messages', 'Visitors send messages from the website chat widget to the dashboard inbox.', true, 170)
on conflict (key) do nothing;

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id text,
  kind text not null check (kind in ('team', 'direct', 'visitor')),
  title text check (title is null or char_length(title) <= 120),
  direct_key text check (direct_key is null or direct_key ~ '^[0-9a-f-]{36}:[0-9a-f-]{36}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  resolved_at timestamptz,
  archived_at timestamptz,
  source_submission_id uuid unique references public.form_submissions (id) on delete set null,
  unique (id, organization_id),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  check ((kind = 'direct') = (direct_key is not null)),
  check ((kind = 'visitor') = (website_id is not null)),
  check (kind = 'visitor' or (resolved_at is null and source_submission_id is null))
);

create unique index chat_conversations_team_uq on public.chat_conversations (organization_id) where kind = 'team';
create unique index chat_conversations_direct_uq on public.chat_conversations (organization_id, direct_key) where kind = 'direct';
create index chat_conversations_org_idx on public.chat_conversations (organization_id, kind, last_message_at desc);
create index chat_conversations_site_idx on public.chat_conversations (website_id, last_message_at desc) where kind = 'visitor';
create index chat_conversations_created_by_idx on public.chat_conversations (created_by);

create table public.chat_visitors (
  conversation_id uuid primary key references public.chat_conversations (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id text not null references public.websites (id) on delete cascade,
  name text check (name is null or char_length(name) <= 120),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  created_at timestamptz not null default now()
);

create index chat_visitors_email_idx on public.chat_visitors (website_id, lower(email));
create index chat_visitors_org_idx on public.chat_visitors (organization_id);

create table public.chat_participants (
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'staff')),
  last_read_at timestamptz,
  muted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index chat_participants_user_idx on public.chat_participants (user_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  organization_id uuid not null,
  kind text not null default 'message' check (kind in ('message', 'note', 'visitor')),
  sender_user_id uuid references auth.users (id) on delete set null,
  sender_label text check (sender_label is null or char_length(sender_label) <= 120),
  body_ciphertext bytea check (body_ciphertext is null or octet_length(body_ciphertext) <= 20000),
  body_key smallint not null default 1,
  reply_to uuid references public.chat_messages (id) on delete set null,
  client_id uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  foreign key (conversation_id, organization_id)
    references public.chat_conversations (id, organization_id) on delete cascade,
  check (deleted_at is not null or body_ciphertext is not null),
  check (kind <> 'visitor' or (sender_user_id is null and sender_label is not null))
);

create index chat_messages_thread_idx on public.chat_messages (conversation_id, created_at desc, id desc);
create index chat_messages_sender_idx on public.chat_messages (sender_user_id, created_at desc) where sender_user_id is not null;
create index chat_messages_org_idx on public.chat_messages (organization_id);
create index chat_messages_reply_idx on public.chat_messages (reply_to) where reply_to is not null;
create unique index chat_messages_client_uq on public.chat_messages (sender_user_id, client_id) where client_id is not null;

-- ---------------------------------------------------------------- access

-- Role of the caller in the organization, from real membership only (platform
-- admins are not included). Null when not a member or the org is archived.
create or replace function private.chat_role(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.organization_id = p_org
    and m.user_id = (select auth.uid())
    and o.status <> 'archived';
$$;

-- Team and visitor conversations: every member of the organization.
-- Direct conversations: their two participants, while both are still members
-- of the organization (the caller is checked here; the other side in the RPCs).
create or replace function private.chat_can_read(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_conversations c
    where c.id = p_conversation
      and private.mfa_satisfied()
      and private.chat_role(c.organization_id) is not null
      and (
        c.kind in ('team', 'visitor')
        or exists (
          select 1 from public.chat_participants p
          where p.conversation_id = c.id and p.user_id = (select auth.uid())
        )
      )
  );
$$;

revoke all on function private.chat_role(uuid) from public, anon;
revoke all on function private.chat_can_read(uuid) from public, anon;
grant execute on function private.chat_role(uuid) to authenticated;
grant execute on function private.chat_can_read(uuid) to authenticated;

alter table public.chat_conversations enable row level security;
alter table public.chat_participants enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_visitors enable row level security;

revoke all on public.chat_conversations, public.chat_participants, public.chat_messages, public.chat_visitors
  from public, anon, authenticated;
grant select on public.chat_conversations, public.chat_participants, public.chat_messages to authenticated;

create policy chat_conversations_select on public.chat_conversations
  for select to authenticated using ((select private.chat_can_read(id)));

create policy chat_messages_select on public.chat_messages
  for select to authenticated using ((select private.chat_can_read(conversation_id)));

create policy chat_participants_select on public.chat_participants
  for select to authenticated using (user_id = (select auth.uid()));

-- chat_visitors: RLS on, no policy, no grant (contact details come from RPCs only).

-- Realtime: inserts and updates of messages reach subscribers that may SELECT
-- the row (RLS). The payload only carries the ciphertext, never the text.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end;
$$;

-- ---------------------------------------------------------------- encryption

-- 256-bit random key, generated inside the database and stored in Vault
-- (encrypted with the project root key, which is not in database dumps).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'chat_message_key_v1') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'chat_message_key_v1',
      'Chat message bodies (pgcrypto AES-256). Never print it; keep a copy only in a password manager.'
    );
  end if;
end;
$$;

create or replace function private.chat_key(p_version integer)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'chat_message_key_v' || p_version::text;
  if v_key is null then
    raise exception 'chat key missing' using errcode = 'XX000';
  end if;
  return v_key;
end;
$$;

create or replace function private.chat_encrypt(p_body text, p_key text)
returns bytea
language sql
volatile
set search_path = ''
as $$
  select extensions.pgp_sym_encrypt(p_body, p_key, 'cipher-algo=aes256, compress-algo=0, s2k-mode=1');
$$;

create or replace function private.chat_decrypt(p_cipher bytea, p_key text)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_cipher is null then null else extensions.pgp_sym_decrypt(p_cipher, p_key) end;
$$;

revoke all on function private.chat_key(integer) from public, anon, authenticated;
revoke all on function private.chat_encrypt(text, text) from public, anon, authenticated;
revoke all on function private.chat_decrypt(bytea, text) from public, anon, authenticated;
