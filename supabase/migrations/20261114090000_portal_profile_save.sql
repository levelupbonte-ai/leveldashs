-- A member saves their own questionnaire into their dossier from the member
-- space. Before 2026-11-12 the website kept the answers only in the browser,
-- so members who paid earlier have no dossier at LevelUp: the member space
-- sends the copy their browser kept, or the questionnaire they fill in again.
-- Also used to add the answers in words ("readable") to an older dossier.

create or replace function public.portal_profile_save(p_key text, p_session text, p_profile jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' or p_profile = '{}'::jsonb
     or pg_column_size(p_profile) > 16000 then
    raise exception 'Invalid dossier' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('portal_profile_save', c.id::text, 20, interval '1 hour');
  update public.portal_customers
  set profile = p_profile, profile_updated_at = now()
  where id = c.id;
  return jsonb_build_object('ok', true, 'profile', p_profile, 'updated_at', now());
end;
$$;

revoke all on function public.portal_profile_save(text, text, jsonb) from public;
grant execute on function public.portal_profile_save(text, text, jsonb) to anon, authenticated;
