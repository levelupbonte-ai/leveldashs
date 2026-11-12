-- The questionnaires a client website saved before payment (e.g. PaterGuide),
-- for the owner: who filled one in, whether they became a member. Prospects
-- who did not pay are listed too (drafts are kept 30 days).
create or replace function public.portal_admin_questionnaires(p_website_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.portal_manage_site(p_website_id);
  return coalesce((
    select jsonb_agg(q order by q ->> 'created_at' desc)
    from (
      select jsonb_build_object(
        'id', d.id::text,
        'created_at', d.created_at,
        'email', d.email,
        'profile', d.profile,
        'customer_id', c.id,
        'member', c.id is not null and private.portal_member_active(c.id)) q
      from (
        select distinct on (coalesce(x.email, x.attempt_id)) x.*
        from private.portal_profile_drafts x
        where x.website_id = p_website_id
        order by coalesce(x.email, x.attempt_id), x.created_at desc
      ) d
      left join lateral (
        select pc.id from public.portal_customers pc
        where pc.website_id = p_website_id and pc.status = 'active'
          and d.email is not null and (pc.email = d.email or d.email = any (pc.payment_emails))
        limit 1
      ) c on true
      union all
      -- Members whose dossier came another way (no draft left).
      select jsonb_build_object(
        'id', pc.id::text,
        'created_at', coalesce(pc.profile_updated_at, pc.created_at),
        'email', pc.email,
        'profile', pc.profile,
        'customer_id', pc.id,
        'member', private.portal_member_active(pc.id))
      from public.portal_customers pc
      where pc.website_id = p_website_id and pc.status = 'active' and pc.profile is not null
        and not exists (select 1 from private.portal_profile_drafts x
                        where x.website_id = p_website_id and x.email is not null
                          and (x.email = pc.email or x.email = any (pc.payment_emails)))
      limit 300
    ) s(q)), '[]'::jsonb);
end;
$$;
revoke all on function public.portal_admin_questionnaires(text) from public;
grant execute on function public.portal_admin_questionnaires(text) to authenticated;
