-- Support tickets: when the dashboard assistant cannot solve a client's problem,
-- it proposes "Send to LevelUp support"; nothing is sent until the user clicks
-- Authorize. The ticket keeps the assistant's triage (category, urgency) and a
-- summary the user saw before sending. HQ reads and updates tickets.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id text references public.websites (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  category text not null check (category in (
    'content', 'bookings', 'requests', 'payments', 'billing', 'email', 'seo',
    'website_bug', 'account_access', 'other')),
  urgency text not null default 'normal' check (urgency in ('low', 'normal', 'high', 'urgent')),
  subject text not null check (char_length(subject) between 3 and 160),
  details text not null check (char_length(details) between 3 and 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists support_tickets_org_idx on public.support_tickets (organization_id, created_at desc);
create index if not exists support_tickets_open_idx on public.support_tickets (status, created_at desc);
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from public, anon, authenticated;
grant select on public.support_tickets to authenticated;
drop policy if exists support_tickets_member_read on public.support_tickets;
create policy support_tickets_member_read on public.support_tickets
  for select to authenticated
  using (private.has_org_role(organization_id, 'viewer'));

-- Client: open a ticket (any member of the organization; 5 an hour, 20 a day).
create or replace function public.support_ticket_create(
  p_website_id text, p_category text, p_urgency text, p_subject text, p_details text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_id uuid;
  v_subject text := btrim(regexp_replace(coalesce(p_subject, ''), '[[:cntrl:]]', ' ', 'g'));
  v_details text := btrim(coalesce(p_details, ''));
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = 'PT401';
  end if;
  select w.organization_id into v_org from public.websites w where w.id = p_website_id;
  if v_org is null or not private.has_org_role(v_org, 'viewer') then
    raise exception 'Not allowed' using errcode = 'PT403';
  end if;
  if v_subject ~ '<[a-zA-Z/!]' or v_details ~ '<[a-zA-Z/!]' then
    raise exception 'invalid text' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('support_ticket_hour', v_uid::text, 5, interval '1 hour');
  perform private.hit_rate_limit('support_ticket_day', v_org::text, 20, interval '1 day');
  insert into public.support_tickets (organization_id, website_id, created_by, category, urgency, subject, details)
  values (v_org, p_website_id, v_uid, p_category, coalesce(nullif(p_urgency, ''), 'normal'),
          left(v_subject, 160), left(v_details, 4000))
  returning id into v_id;
  perform private.site_audit(p_website_id, v_org, 'support.ticket_created', v_id::text,
    jsonb_build_object('category', p_category, 'urgency', p_urgency));
  return v_id;
end;
$$;
revoke all on function public.support_ticket_create(text, text, text, text, text) from public, anon;
grant execute on function public.support_ticket_create(text, text, text, text, text) to authenticated;

-- HQ: tickets of every client (clients.read), newest first, open ones first.
create or replace function public.hq_list_support_tickets(p_status text default null, p_page integer default 1, p_per_page integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_per integer := least(greatest(coalesce(p_per_page, 50), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
begin
  perform private.hq_assert('clients.read');
  return (
    with f as (
      select t.*, o.name as org_name
      from public.support_tickets t join public.organizations o on o.id = t.organization_id
      where p_status is null or t.status = p_status
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'open', (select count(*) from public.support_tickets t where t.status in ('open', 'in_progress')),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', x.id, 'created_at', x.created_at, 'organization', x.org_name,
                 'website_id', x.website_id, 'category', x.category, 'urgency', x.urgency,
                 'subject', x.subject, 'details', x.details, 'status', x.status,
                 'by', private.hq_pii((select u.email from auth.users u where u.id = x.created_by), 'email'))
               order by (x.status in ('open', 'in_progress')) desc,
                        array_position(array['urgent', 'high', 'normal', 'low'], x.urgency), x.created_at desc)
        from (select * from f
              order by (f.status in ('open', 'in_progress')) desc,
                       array_position(array['urgent', 'high', 'normal', 'low'], f.urgency), f.created_at desc
              offset (v_page - 1) * v_per limit v_per) x), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.hq_list_support_tickets(text, integer, integer) from public, anon;
grant execute on function public.hq_list_support_tickets(text, integer, integer) to authenticated;

-- HQ: move a ticket along (clients.write), logged.
create or replace function public.hq_set_support_ticket_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.hq_assert('clients.write');
  if p_status not in ('open', 'in_progress', 'resolved', 'closed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update public.support_tickets
     set status = p_status, updated_at = now(),
         resolved_at = case when p_status in ('resolved', 'closed') then now() else null end
   where id = p_id;
  if not found then
    raise exception 'Unknown ticket' using errcode = 'PT404';
  end if;
  perform private.hq_log('support.ticket_status', 'support_ticket', p_id::text, jsonb_build_object('status', p_status));
end;
$$;
revoke all on function public.hq_set_support_ticket_status(uuid, text) from public, anon;
grant execute on function public.hq_set_support_ticket_status(uuid, text) to authenticated;
