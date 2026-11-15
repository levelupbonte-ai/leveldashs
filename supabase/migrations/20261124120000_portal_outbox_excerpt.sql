-- Announcements to every member carry the first lines of the message in the
-- e-mail (members without the app read it there). Personal items, selected
-- members and plan-only items never put their content in an e-mail.
do $do$
declare
  v_def text := pg_get_functiondef('public.portal_outbox_claim(text, integer)'::regprocedure);
  v_anchor text := $a$jsonb_build_object('kind', it.kind, 'title', it.title)$a$;
begin
  if position('excerpt' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'portal_outbox_claim: anchor not found';
  end if;
  execute replace(v_def, v_anchor, $b$jsonb_build_object('kind', it.kind, 'title', it.title,
        'excerpt', case when it.kind = 'update' and it.audience = 'all' and coalesce(it.min_level, 0) = 0 then left(it.body, 700) end)$b$);
end;
$do$;
