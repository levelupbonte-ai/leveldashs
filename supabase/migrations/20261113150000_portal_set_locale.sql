-- The member space's language follows the member: changing it in the space
-- (or the installed app) also changes the language of their e-mails and
-- notifications.
create or replace function public.portal_set_locale(p_key text, p_session text, p_locale text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.portal_customers;
begin
  c := private.portal_session(p_key, p_session);
  if p_locale is null or p_locale not in ('en', 'fr') then
    raise exception 'Invalid locale' using errcode = '22023';
  end if;
  if c.locale is distinct from p_locale then
    perform private.hit_rate_limit('portal_set_locale', c.id::text, 30, interval '1 hour');
    update public.portal_customers set locale = p_locale where id = c.id;
  end if;
  return jsonb_build_object('ok', true, 'locale', p_locale);
end;
$$;
revoke all on function public.portal_set_locale(text, text, text) from public;
grant execute on function public.portal_set_locale(text, text, text) to anon, authenticated;
