-- studio_credit_grants_total(p_user) told anyone (anon key) how many studio
-- credits a given account had bought. Only the LevelStudio server calls it (with
-- its server key), so browsers lose the right to call it.
revoke execute on function public.studio_credit_grants_total(uuid) from public, anon, authenticated;
grant execute on function public.studio_credit_grants_total(uuid) to service_role;
