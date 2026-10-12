-- Contracts: clients sign their LevelUp contract (Master Services Agreement +
-- order form) in the dashboard before using it, and finish the setup tasks LevelUp
-- marks as blocking.
--
-- * contract_templates — staff-managed agreement texts (key, version, locale).
-- * contracts — one per organization (optionally per website): a frozen snapshot of
--   the template (official English text + French translation) and the order form,
--   draft -> sent -> signed -> void / superseded, SHA-256 of the exact snapshot.
-- * contract_signatures — written only by public.sign_contract(); immutable.
-- * organization_required_tasks — setup checklist steps LevelUp makes blocking.
-- * public.org_access_state(org) / public.dashboard_access(org) — active |
--   contract_required | tasks_required | suspended, used by the dashboard gate.
-- * Restrictive policies: site content and media writes are refused while the
--   organization has a required contract waiting for signature (staff exempt).
--
-- Every write except sign_contract goes through platform-admin RPCs
-- (private.assert_platform_admin: LevelUp staff with an aal2 session).

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key in ('msa', 'order_form')),
  version integer not null check (version between 1 and 1000),
  locale text not null check (locale in ('en', 'fr')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null check (char_length(body) between 1 and 200000),
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (key, version, locale)
);

comment on table public.contract_templates is
  'LevelUp contract texts (Markdown). English is the official version; French is a translation. Published rows are immutable: publish a new version instead.';

alter table public.contract_templates enable row level security;
revoke all on public.contract_templates from anon, authenticated;
grant select on public.contract_templates to authenticated;

create policy contract_templates_select_staff on public.contract_templates
  for select to authenticated
  using ((select private.is_platform_admin()));

-- ---------------------------------------------------------------------------
-- Contracts
-- ---------------------------------------------------------------------------

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  website_id text,
  template_key text not null check (template_key in ('msa', 'order_form')),
  template_version integer not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- Language the client reads first; the English body always prevails.
  locale text not null default 'en' check (locale in ('en', 'fr')),
  body text not null check (char_length(body) between 1 and 200000),
  translated_body text check (translated_body is null or char_length(translated_body) <= 200000),
  order_form jsonb not null default '{}'::jsonb
    check (jsonb_typeof(order_form) = 'object' and pg_column_size(order_form) <= 20000),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'signed', 'void', 'superseded')),
  required boolean not null default true,
  document_hash text check (document_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references auth.users (id) on delete set null,
  signed_at timestamptz,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  superseded_by uuid references public.contracts (id) on delete restrict,
  emailed_at timestamptz,
  foreign key (website_id, organization_id)
    references public.websites (id, organization_id) on delete restrict,
  check (status in ('draft', 'void') or (document_hash is not null and sent_at is not null)),
  check (status <> 'signed' or signed_at is not null)
);

create index if not exists contracts_org_status_idx on public.contracts (organization_id, status);
create index if not exists contracts_superseded_by_idx on public.contracts (superseded_by);
create index if not exists contracts_website_idx on public.contracts (website_id);

alter table public.contracts enable row level security;
revoke all on public.contracts from anon, authenticated;
grant select on public.contracts to authenticated;

-- Members read their organization's contracts once sent; drafts are staff-only.
create policy contracts_select on public.contracts
  for select to authenticated
  using (
    private.has_org_role(organization_id, 'viewer')
    and (status <> 'draft' or (select private.is_platform_admin()))
  );

-- ---------------------------------------------------------------------------
-- Signatures
-- ---------------------------------------------------------------------------

create table if not exists public.contract_signatures (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null unique references public.contracts (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  user_id uuid references auth.users (id) on delete set null,
  signer_email text not null check (char_length(signer_email) <= 320),
  signer_name text not null check (char_length(signer_name) between 2 and 120),
  signer_title text not null check (char_length(signer_title) between 1 and 120),
  consent boolean not null check (consent),
  -- Optional drawn signature: SVG path data (M/L commands, integer coordinates in
  -- a 600 x 200 box), size-limited. Never markup.
  drawn_signature text check (
    drawn_signature is null
    or (char_length(drawn_signature) <= 20000 and drawn_signature ~ '^[ML0-9 ]+$')
  ),
  ip inet,
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz not null default now()
);

create index if not exists contract_signatures_org_idx on public.contract_signatures (organization_id);
create index if not exists contract_signatures_user_idx on public.contract_signatures (user_id);

alter table public.contract_signatures enable row level security;
revoke all on public.contract_signatures from anon, authenticated;
grant select on public.contract_signatures to authenticated;

create policy contract_signatures_select on public.contract_signatures
  for select to authenticated
  using (private.has_org_role(organization_id, 'viewer'));

-- Signatures never change, even for the table owner (SECURITY DEFINER functions).
create or replace function private.contract_signatures_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'contract signatures are immutable' using errcode = 'PT403';
end;
$$;

create trigger contract_signatures_no_update
  before update or delete on public.contract_signatures
  for each row execute function private.contract_signatures_immutable();

-- ---------------------------------------------------------------------------
-- Blocking setup tasks
-- ---------------------------------------------------------------------------

create table if not exists public.organization_required_tasks (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task text not null check (task in ('profile', 'logo', 'mfa')),
  -- false: the step is listed but no longer blocks (switched off by LevelUp).
  required boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, task)
);

alter table public.organization_required_tasks enable row level security;
revoke all on public.organization_required_tasks from anon, authenticated;
grant select on public.organization_required_tasks to authenticated;

create policy organization_required_tasks_select on public.organization_required_tasks
  for select to authenticated
  using (private.has_org_role(organization_id, 'viewer'));

-- ---------------------------------------------------------------------------
-- Integrity: the snapshot is frozen once sent; only valid status changes
-- ---------------------------------------------------------------------------

-- SHA-256 of exactly what the client reviews: the official English text, the
-- French translation (empty when none) and the order form, as stored.
create or replace function private.contract_document_hash(p_body text, p_translated text, p_order_form jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    sha256(convert_to(p_body || E'\n\n' || coalesce(p_translated, '') || E'\n\n' || p_order_form::text, 'UTF8')),
    'hex'
  );
$$;

create or replace function private.contracts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'only draft contracts can be deleted' using errcode = 'PT403';
    end if;
    return old;
  end if;

  new.updated_at := now();
  if old.status = 'draft' then
    if new.status not in ('draft', 'sent', 'void') then
      raise exception 'invalid contract status change' using errcode = 'PT409';
    end if;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.website_id is distinct from old.website_id
     or new.template_key is distinct from old.template_key
     or new.template_version is distinct from old.template_version
     or new.title is distinct from old.title
     or new.locale is distinct from old.locale
     or new.body is distinct from old.body
     or new.translated_body is distinct from old.translated_body
     or new.order_form is distinct from old.order_form
     or new.document_hash is distinct from old.document_hash
     or new.sent_at is distinct from old.sent_at
     or new.sent_by is distinct from old.sent_by
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a sent contract cannot be edited' using errcode = 'PT403';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'sent' and new.status in ('signed', 'void'))
    or (old.status = 'signed' and new.status in ('superseded', 'void'))
  ) then
    raise exception 'invalid contract status change' using errcode = 'PT409';
  end if;
  if old.signed_at is not null and new.signed_at is distinct from old.signed_at then
    raise exception 'signature date is immutable' using errcode = 'PT403';
  end if;
  return new;
end;
$$;

create trigger contracts_guard
  before update or delete on public.contracts
  for each row execute function private.contracts_guard();

create or replace function private.contract_templates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.published_at is not null then
    raise exception 'published templates are immutable: publish a new version' using errcode = 'PT403';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger contract_templates_guard
  before update or delete on public.contract_templates
  for each row execute function private.contract_templates_guard();

-- ---------------------------------------------------------------------------
-- Access state
-- ---------------------------------------------------------------------------

-- True while the organization has a required contract waiting for signature.
-- LevelUp staff are never locked.
create or replace function private.org_contract_locked(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_org is not null
    and not private.is_platform_admin()
    and exists (
      select 1 from public.contracts c
      where c.organization_id = p_org and c.required and c.status = 'sent'
    );
$$;

revoke all on function private.org_contract_locked(uuid) from public, anon;
grant execute on function private.org_contract_locked(uuid) to authenticated;

-- For future write RPCs on client content: refuse while a contract must be signed.
create or replace function private.assert_org_unlocked(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.org_contract_locked(p_org) then
    raise exception 'contract signature required' using errcode = 'PT423';
  end if;
end;
$$;

revoke all on function private.assert_org_unlocked(uuid) from public, anon;
grant execute on function private.assert_org_unlocked(uuid) to authenticated;

-- Blocking setup tasks the caller still has to finish in this organization.
create or replace function private.org_pending_tasks(p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.task order by t.task), '{}')
  from public.organization_required_tasks t
  where t.organization_id = p_org
    and t.required
    and case t.task
      when 'profile' then not exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and char_length(btrim(coalesce(p.full_name, ''))) >= 2
      )
      -- Only people who can upload the logo are held by it.
      when 'logo' then private.has_org_role(p_org, 'admin') and not exists (
        select 1 from public.organizations o where o.id = p_org and o.logo_url is not null
      )
      when 'mfa' then not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status = 'verified'
      )
      else false
    end;
$$;

revoke all on function private.org_pending_tasks(uuid) from public, anon, authenticated;

-- active | contract_required | tasks_required | suspended for the caller in this
-- organization; null when the caller is not a member. `suspended` follows
-- organizations.status and is reserved for billing.
create or replace function public.org_access_state(p_org_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if auth.uid() is null or p_org_id is null then
    return null;
  end if;
  if private.is_platform_admin() then
    return 'active';
  end if;
  if not private.has_org_role(p_org_id, 'viewer') then
    return null;
  end if;
  select o.status into v_status from public.organizations o where o.id = p_org_id;
  if v_status = 'suspended' then
    return 'suspended';
  end if;
  if private.org_contract_locked(p_org_id) then
    return 'contract_required';
  end if;
  if cardinality(private.org_pending_tasks(p_org_id)) > 0 then
    return 'tasks_required';
  end if;
  return 'active';
end;
$$;

revoke all on function public.org_access_state(uuid) from public, anon;
grant execute on function public.org_access_state(uuid) to authenticated;

-- What the dashboard needs for its gate, in one call. p_org_id is the active
-- organization cookie; when it is not one of the caller's organizations, the
-- first one by name is used (same choice as the dashboard session).
create or replace function public.dashboard_access(p_org_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_staff boolean;
begin
  if v_uid is null then
    return null;
  end if;
  v_staff := private.is_platform_admin();
  select o.id into v_org
  from public.organizations o
  where o.status <> 'archived'
    and (v_staff or exists (
      select 1 from public.organization_members m where m.organization_id = o.id and m.user_id = v_uid
    ))
  order by (o.id = p_org_id) desc, o.name
  limit 1;
  if v_org is null then
    return jsonb_build_object('organization_id', null, 'state', 'active', 'pending_tasks', '[]'::jsonb, 'has_contracts', false);
  end if;
  return jsonb_build_object(
    'organization_id', v_org,
    'state', public.org_access_state(v_org),
    'pending_tasks', case when v_staff then '[]'::jsonb else to_jsonb(private.org_pending_tasks(v_org)) end,
    'has_contracts', exists (
      select 1 from public.contracts c where c.organization_id = v_org and c.status <> 'draft'
    )
  );
end;
$$;

revoke all on function public.dashboard_access(uuid) from public, anon;
grant execute on function public.dashboard_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Site content is read-only while a required contract waits for signature
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'website_settings', 'content_blocks', 'team_members', 'services', 'gallery_items',
    'reviews', 'faq_items', 'announcements', 'media'
  ] loop
    execute format(
      'create policy %1$I on public.%2$I as restrictive for insert to authenticated with check (not private.org_contract_locked(organization_id))',
      t || '_contract_insert', t);
    execute format(
      'create policy %1$I on public.%2$I as restrictive for update to authenticated using (not private.org_contract_locked(organization_id)) with check (not private.org_contract_locked(organization_id))',
      t || '_contract_update', t);
    execute format(
      'create policy %1$I on public.%2$I as restrictive for delete to authenticated using (not private.org_contract_locked(organization_id))',
      t || '_contract_delete', t);
  end loop;
end;
$$;

create policy websites_contract_update on public.websites
  as restrictive for update to authenticated
  using (not private.org_contract_locked(organization_id))
  with check (not private.org_contract_locked(organization_id));

create policy media_objects_contract_insert on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'media' or not private.org_contract_locked(private.safe_uuid(split_part(name, '/', 1))));

create policy media_objects_contract_update on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'media' or not private.org_contract_locked(private.safe_uuid(split_part(name, '/', 1))))
  with check (bucket_id <> 'media' or not private.org_contract_locked(private.safe_uuid(split_part(name, '/', 1))));

create policy media_objects_contract_delete on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id <> 'media' or not private.org_contract_locked(private.safe_uuid(split_part(name, '/', 1))));

-- ---------------------------------------------------------------------------
-- Signed PDFs: private bucket, <organization id>/<contract id>.pdf
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contracts', 'contracts', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The archive copy is written once, after signature, by an owner/admin of the
-- organization (or staff). No update or delete through the API.
create or replace function private.can_store_contract_pdf(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.contracts c
    where c.status in ('signed', 'superseded')
      and p_name = c.organization_id::text || '/' || c.id::text || '.pdf'
      and private.has_org_role(c.organization_id, 'admin')
  );
$$;

revoke all on function private.can_store_contract_pdf(text) from public, anon;
grant execute on function private.can_store_contract_pdf(text) to authenticated;

create policy contracts_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contracts'
    and private.has_org_role(private.safe_uuid(split_part(name, '/', 1)), 'viewer')
  );

create policy contracts_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'contracts' and private.can_store_contract_pdf(name));

-- ---------------------------------------------------------------------------
-- Order form
-- ---------------------------------------------------------------------------

create or replace function private.clean_amount(p jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p) = 'number' and (p #>> '{}')::numeric between 0 and 10000000
      then round((p #>> '{}')::numeric, 2)
  end;
$$;

-- Keeps only the known order-form fields, trimmed and bounded.
create or replace function private.clean_order_form(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_start text := private.clean_text(p ->> 'startDate', 10);
begin
  if v_start is not null and v_start !~ '^\d{4}-\d{2}-\d{2}$' then
    v_start := null;
  end if;
  if v_start is not null then
    begin
      perform v_start::date;
    exception when others then
      v_start := null;
    end;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'projectName', private.clean_text(p ->> 'projectName', 120),
    'packageName', private.clean_text(p ->> 'packageName', 120),
    'scope', nullif(to_jsonb(private.clean_text_array(p -> 'scope', 20, 200)), '[]'::jsonb),
    'buildPrice', private.clean_amount(p -> 'buildPrice'),
    'paymentSchedule', private.clean_text(p ->> 'paymentSchedule', 500),
    'monthlyPlan', private.clean_text(p ->> 'monthlyPlan', 120),
    'monthlyPrice', private.clean_amount(p -> 'monthlyPrice'),
    'startDate', v_start,
    'notes', private.clean_text(p ->> 'notes', 1000)
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff RPCs (platform admins, aal2)
-- ---------------------------------------------------------------------------

-- New draft from the latest published version of a template (English text +
-- French translation of the same version when there is one).
create or replace function public.admin_create_contract(
  p_organization_id uuid,
  p_template_key text default 'msa',
  p_website_id text default null,
  p_locale text default 'en',
  p_order_form jsonb default '{}'::jsonb,
  p_required boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
  v_en public.contract_templates;
  v_fr public.contract_templates;
  v_id uuid;
begin
  perform private.assert_platform_admin();
  if not exists (select 1 from public.organizations o where o.id = p_organization_id and o.status <> 'archived') then
    raise exception 'organization not found' using errcode = 'PT404';
  end if;
  if p_website_id is not null and not exists (
    select 1 from public.websites w where w.id = p_website_id and w.organization_id = p_organization_id
  ) then
    raise exception 'website not found' using errcode = 'PT404';
  end if;
  select max(t.version) into v_version
  from public.contract_templates t
  where t.key = p_template_key and t.locale = 'en' and t.published_at is not null;
  if v_version is null then
    raise exception 'template not found' using errcode = 'PT404';
  end if;
  select * into v_en from public.contract_templates t
  where t.key = p_template_key and t.version = v_version and t.locale = 'en';
  select * into v_fr from public.contract_templates t
  where t.key = p_template_key and t.version = v_version and t.locale = 'fr' and t.published_at is not null;

  insert into public.contracts (
    organization_id, website_id, template_key, template_version, title, locale,
    body, translated_body, order_form, required, created_by
  ) values (
    p_organization_id, p_website_id, p_template_key, v_version, v_en.title,
    case when p_locale = 'fr' and v_fr.id is not null then 'fr' else 'en' end,
    v_en.body, v_fr.body, private.clean_order_form(coalesce(p_order_form, '{}'::jsonb)),
    coalesce(p_required, true), auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Edit a draft (order form, website, language, required).
create or replace function public.admin_update_contract(
  p_contract_id uuid,
  p_order_form jsonb,
  p_required boolean,
  p_website_id text default null,
  p_locale text default 'en'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.contracts;
begin
  perform private.assert_platform_admin();
  select * into v from public.contracts c where c.id = p_contract_id for update;
  if v.id is null then
    raise exception 'contract not found' using errcode = 'PT404';
  end if;
  if v.status <> 'draft' then
    raise exception 'only drafts can be edited' using errcode = 'PT409';
  end if;
  if p_website_id is not null and not exists (
    select 1 from public.websites w where w.id = p_website_id and w.organization_id = v.organization_id
  ) then
    raise exception 'website not found' using errcode = 'PT404';
  end if;
  update public.contracts c set
    order_form = private.clean_order_form(coalesce(p_order_form, '{}'::jsonb)),
    required = coalesce(p_required, c.required),
    website_id = p_website_id,
    locale = case when p_locale = 'fr' and c.translated_body is not null then 'fr' else 'en' end
  where c.id = p_contract_id;
end;
$$;

-- Freeze the draft, compute its SHA-256 and mark it sent. An unsigned contract of
-- the same kind for the same organization/website is voided (replaced). Returns
-- who to notify: owners and admins of the organization, with their language.
create or replace function public.admin_send_contract(p_contract_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.contracts;
  v_org_name text;
  v_form jsonb;
begin
  perform private.assert_platform_admin();
  select * into v from public.contracts c where c.id = p_contract_id for update;
  if v.id is null then
    raise exception 'contract not found' using errcode = 'PT404';
  end if;
  if v.status <> 'draft' then
    raise exception 'contract already sent' using errcode = 'PT409';
  end if;
  select o.name into v_org_name from public.organizations o where o.id = v.organization_id;
  v_form := v.order_form || jsonb_build_object('client', v_org_name);

  update public.contracts c set status = 'void', voided_at = now(), void_reason = 'replaced'
  where c.organization_id = v.organization_id
    and c.template_key = v.template_key
    and c.website_id is not distinct from v.website_id
    and c.status = 'sent'
    and c.id <> v.id;

  update public.contracts c set
    order_form = v_form,
    status = 'sent',
    sent_at = now(),
    sent_by = auth.uid(),
    document_hash = private.contract_document_hash(c.body, c.translated_body, v_form)
  where c.id = v.id;

  return jsonb_build_object(
    'contract_id', v.id,
    'organization_name', v_org_name,
    'title', v.title,
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', u.email,
        'locale', u.raw_user_meta_data ->> 'locale'
      ))
      from public.organization_members m
      join auth.users u on u.id = m.user_id
      where m.organization_id = v.organization_id
        and m.role in ('owner', 'admin')
        and u.email is not null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_void_contract(p_contract_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.contracts;
begin
  perform private.assert_platform_admin();
  select * into v from public.contracts c where c.id = p_contract_id for update;
  if v.id is null then
    raise exception 'contract not found' using errcode = 'PT404';
  end if;
  if v.status not in ('draft', 'sent', 'signed') then
    raise exception 'contract already closed' using errcode = 'PT409';
  end if;
  update public.contracts c
  set status = 'void', voided_at = now(), void_reason = private.clean_text(p_reason, 500)
  where c.id = p_contract_id;
end;
$$;

-- Lets a client in before signing (or locks them again) without voiding.
create or replace function public.admin_set_contract_required(p_contract_id uuid, p_required boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_platform_admin();
  update public.contracts c set required = coalesce(p_required, true)
  where c.id = p_contract_id and c.status in ('draft', 'sent');
  if not found then
    raise exception 'contract not found or closed' using errcode = 'PT409';
  end if;
end;
$$;

-- New draft from the latest template version with the same order form: used when
-- a newer version is published. The client signs it again once it is sent; the
-- old signature stays on record (the old contract becomes `superseded`).
create or replace function public.admin_reissue_contract(p_contract_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.contracts;
begin
  perform private.assert_platform_admin();
  select * into v from public.contracts c where c.id = p_contract_id;
  if v.id is null then
    raise exception 'contract not found' using errcode = 'PT404';
  end if;
  if v.status = 'draft' then
    raise exception 'contract is still a draft' using errcode = 'PT409';
  end if;
  return public.admin_create_contract(
    v.organization_id, v.template_key, v.website_id, v.locale, v.order_form - 'client', v.required
  );
end;
$$;

-- Marks which setup steps block the organization (the others are switched off).
create or replace function public.admin_set_required_tasks(p_organization_id uuid, p_tasks text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_platform_admin();
  if not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'organization not found' using errcode = 'PT404';
  end if;
  insert into public.organization_required_tasks (organization_id, task, required, created_by)
  select p_organization_id, x, x = any (coalesce(p_tasks, '{}')), auth.uid()
  from unnest(array['profile', 'logo', 'mfa']) as x
  on conflict (organization_id, task) do update set required = excluded.required;
end;
$$;

-- Publish a template text. Without a version, English starts the next version;
-- a French translation names the English version it translates.
create or replace function public.admin_publish_contract_template(
  p_key text,
  p_locale text,
  p_title text,
  p_body text,
  p_version integer default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer := p_version;
begin
  perform private.assert_platform_admin();
  if p_key not in ('msa', 'order_form') or p_locale not in ('en', 'fr') then
    raise exception 'invalid template' using errcode = '22023';
  end if;
  if v_version is null then
    if p_locale <> 'en' then
      raise exception 'a translation needs the version it translates' using errcode = '22023';
    end if;
    select coalesce(max(t.version), 0) + 1 into v_version
    from public.contract_templates t where t.key = p_key;
  elsif p_locale = 'fr' and not exists (
    select 1 from public.contract_templates t
    where t.key = p_key and t.version = v_version and t.locale = 'en'
  ) then
    raise exception 'english version not found' using errcode = 'PT404';
  end if;
  insert into public.contract_templates (key, version, locale, title, body, published_at, created_by)
  values (p_key, v_version, p_locale, btrim(p_title), p_body, now(), auth.uid());
  return v_version;
exception when unique_violation then
  raise exception 'version already published' using errcode = 'PT409';
end;
$$;

-- ---------------------------------------------------------------------------
-- Client RPCs
-- ---------------------------------------------------------------------------

-- The only way to create a signature. The caller must be an owner or admin of the
-- organization (LevelUp staff never sign for a client), the contract must be
-- `sent`, its stored snapshot must still match its SHA-256 and the hash the
-- client reviewed. IP and user agent come from the request headers set by the
-- Supabase API gateway; the time is the database's.
create or replace function public.sign_contract(
  p_contract_id uuid,
  p_full_name text,
  p_title text,
  p_drawn_signature text,
  p_consent boolean,
  p_document_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v public.contracts;
  v_name text := private.clean_text(p_full_name, 120);
  v_title text := private.clean_text(p_title, 120);
  v_drawing text := nullif(btrim(coalesce(p_drawn_signature, '')), '');
  v_headers jsonb;
  v_ip_text text;
  v_ip inet;
  v_email text;
  v_signature uuid;
  v_signed_at timestamptz;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  perform private.assert_mfa();
  select * into v from public.contracts c where c.id = p_contract_id for update;
  if v.id is null or not exists (
    select 1 from public.organization_members m
    where m.organization_id = v.organization_id and m.user_id = v_uid and m.role in ('owner', 'admin')
  ) then
    raise exception 'not allowed to sign this contract' using errcode = 'PT403';
  end if;
  if v.status <> 'sent' then
    raise exception 'contract is not waiting for a signature' using errcode = 'PT409';
  end if;
  if p_consent is not true then
    raise exception 'consent is required' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) < 2 or v_title is null then
    raise exception 'name and title are required' using errcode = '22023';
  end if;
  if v_drawing is not null and (char_length(v_drawing) > 20000 or v_drawing !~ '^[ML0-9 ]+$') then
    raise exception 'invalid drawn signature' using errcode = '22023';
  end if;
  if v.document_hash is distinct from private.contract_document_hash(v.body, v.translated_body, v.order_form)
     or v.document_hash is distinct from lower(btrim(coalesce(p_document_hash, ''))) then
    raise exception 'the document changed: reload it before signing' using errcode = 'PT409';
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip_text := btrim(coalesce(
    v_headers ->> 'cf-connecting-ip',
    split_part(v_headers ->> 'x-forwarded-for', ',', 1),
    v_headers ->> 'x-real-ip',
    ''
  ));
  begin
    v_ip := nullif(v_ip_text, '')::inet;
  exception when others then
    v_ip := null;
  end;

  select u.email into v_email from auth.users u where u.id = v_uid;

  insert into public.contract_signatures (
    contract_id, organization_id, user_id, signer_email, signer_name, signer_title,
    consent, drawn_signature, ip, user_agent, document_hash
  ) values (
    v.id, v.organization_id, v_uid, coalesce(v_email, ''), v_name, v_title,
    true, v_drawing, v_ip, left(v_headers ->> 'user-agent', 512), v.document_hash
  )
  returning id, signed_at into v_signature, v_signed_at;

  update public.contracts c set status = 'signed', signed_at = v_signed_at where c.id = v.id;

  -- The previous signed version of the same contract stays on record, superseded.
  update public.contracts c set status = 'superseded', superseded_by = v.id
  where c.organization_id = v.organization_id
    and c.template_key = v.template_key
    and c.website_id is not distinct from v.website_id
    and c.status = 'signed'
    and c.id <> v.id;

  return jsonb_build_object('signature_id', v_signature, 'signed_at', v_signed_at);
end;
$$;

-- The signed copy is e-mailed once: true the first time (for the signer or staff).
create or replace function public.mark_contract_emailed(p_contract_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = 'PT401';
  end if;
  update public.contracts c set emailed_at = now()
  where c.id = p_contract_id
    and c.status = 'signed'
    and c.emailed_at is null
    and (
      private.is_platform_admin()
      or exists (
        select 1 from public.contract_signatures s
        where s.contract_id = c.id and s.user_id = auth.uid()
      )
    );
  return found;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.admin_create_contract(uuid, text, text, text, jsonb, boolean)',
    'public.admin_update_contract(uuid, jsonb, boolean, text, text)',
    'public.admin_send_contract(uuid)',
    'public.admin_void_contract(uuid, text)',
    'public.admin_set_contract_required(uuid, boolean)',
    'public.admin_reissue_contract(uuid)',
    'public.admin_set_required_tasks(uuid, text[])',
    'public.admin_publish_contract_template(text, text, text, text, integer)',
    'public.sign_contract(uuid, text, text, text, boolean, text)',
    'public.mark_contract_emailed(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

revoke all on function private.contract_document_hash(text, text, jsonb) from public, anon, authenticated;
revoke all on function private.clean_order_form(jsonb) from public, anon, authenticated;
revoke all on function private.clean_amount(jsonb) from public, anon, authenticated;
revoke all on function private.contracts_guard() from public, anon, authenticated;
revoke all on function private.contract_templates_guard() from public, anon, authenticated;
revoke all on function private.contract_signatures_immutable() from public, anon, authenticated;
