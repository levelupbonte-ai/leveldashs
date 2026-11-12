-- The payment page knows who pays and whom to contact: billing_checkout_prepare
-- also returns the signed-in payer's e-mail (pre-filled on Square) and
-- LevelUp's billing e-mail (shown as the support address), when set.
do $patch$
declare
  v_def text;
  v_anchor text := $a$'previous_session_id', v_k.previous_session_id);$a$;
begin
  v_def := pg_get_functiondef('public.billing_checkout_prepare(uuid)'::regprocedure);
  if position('buyer_email' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'anchor not found in billing_checkout_prepare';
  end if;
  execute replace(v_def, v_anchor, $a$'previous_session_id', v_k.previous_session_id,
    'buyer_email', (select u.email from auth.users u where u.id = (select auth.uid())),
    'support_email', (select i.email from public.billing_issuers i where i.email is not null limit 1));$a$);
end;
$patch$;
