-- Premium meetings: the member's registration id, so they can leave a meeting.
do $do$
declare
  v_def text := pg_get_functiondef('public.portal_calls_home(text, text)'::regprocedure);
  v_anchor text := $a$'title', s.title,
        'joined',$a$;
begin
  if position('call_id' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'portal_calls_home: anchor not found';
  end if;
  execute replace(v_def, v_anchor, $b$'title', s.title,
        'call_id', (select k.id from public.portal_calls k where k.slot_id = s.id and k.customer_id = c.id and k.status <> 'canceled' limit 1),
        'joined',$b$);
end;
$do$;
