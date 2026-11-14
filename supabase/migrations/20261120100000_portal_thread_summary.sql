-- AI summary of a member's conversation, for the team (client portal inbox and
-- chat): what the member wants, a short summary, urgency and the next step.
-- Written by the dashboard server after an AI call made with the editor's own
-- session; kept until the member writes again (then marked stale), so the AI is
-- called once per new message burst, not on every opening.
-- Applied as migration portal_thread_summary.
--
--   portal_admin_thread_summary(customer)                  the stored summary + whether it is stale
--   portal_admin_thread_summary_save(customer, upto, json) store it (editor+, 60 per hour per user)

alter table private.portal_inbox_state
  add column if not exists ai_summary jsonb check (ai_summary is null or pg_column_size(ai_summary) <= 4000),
  add column if not exists ai_summary_upto uuid,
  add column if not exists ai_summary_at timestamptz;

create or replace function public.portal_admin_thread_summary(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
  s private.portal_inbox_state;
  v_last uuid;
begin
  select * into c from public.portal_customers where id = p_customer_id;
  if c.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.portal_manage_site(c.website_id);
  select * into s from private.portal_inbox_state where customer_id = c.id;
  select m.id into v_last from public.portal_messages m
    where m.customer_id = c.id and m.sender = 'customer' order by m.created_at desc limit 1;
  return jsonb_build_object(
    'summary', s.ai_summary,
    'at', s.ai_summary_at,
    'has_messages', v_last is not null,
    'last_message', v_last,
    'stale', v_last is not null and (s.ai_summary is null or s.ai_summary_upto is distinct from v_last));
end;
$$;

create or replace function public.portal_admin_thread_summary_save(p_customer_id uuid, p_upto uuid, p_summary jsonb)
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
  perform private.hit_rate_limit('portal_thread_summary', (select auth.uid())::text, 60, interval '1 hour');
  if jsonb_typeof(p_summary) is distinct from 'object' or pg_column_size(p_summary) > 4000 then
    raise exception 'Invalid summary' using errcode = '22023';
  end if;
  if not exists (select 1 from public.portal_messages m where m.id = p_upto and m.customer_id = c.id) then
    raise exception 'Invalid summary' using errcode = '22023';
  end if;
  insert into private.portal_inbox_state (customer_id, ai_summary, ai_summary_upto, ai_summary_at)
  values (c.id, p_summary, p_upto, now())
  on conflict (customer_id) do update
    set ai_summary = excluded.ai_summary, ai_summary_upto = excluded.ai_summary_upto, ai_summary_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.portal_admin_thread_summary(uuid), public.portal_admin_thread_summary_save(uuid, uuid, jsonb) from public, anon;
grant execute on function public.portal_admin_thread_summary(uuid), public.portal_admin_thread_summary_save(uuid, uuid, jsonb) to authenticated;

-- The inbox list shows what the member wants (AI) under their name.
-- Applied as migration portal_inbox_ai_need (patches portal_admin_inbox in place).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.portal_admin_inbox(text)'::regprocedure);
  if position('s.draft, s.draft_updated_at,' in d) = 0 then
    raise exception 'portal_admin_inbox: pattern not found';
  end if;
  d := replace(d, 's.draft, s.draft_updated_at,',
    's.draft, s.draft_updated_at, left(s.ai_summary ->> ''need'', 140) as ai_need, coalesce(s.ai_summary ->> ''urgency'', '''') as ai_urgency,');
  execute d;
end $$;
