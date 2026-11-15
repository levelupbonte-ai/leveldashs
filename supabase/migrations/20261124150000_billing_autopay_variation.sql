-- A Square subscription names its plan variation, not the LevelUp plan: the
-- plan, price and currency come from private.billing_square_plans.
do $do$
declare
  v_def text := pg_get_functiondef('public.billing_autopay_sync(text, jsonb)'::regprocedure);
  v_anchor text := $a$  if v_plan is not null and not exists (select 1 from public.plans where key = v_plan) then$a$;
begin
  if position('billing_square_plans' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'billing_autopay_sync: anchor not found';
  end if;
  execute replace(v_def, v_anchor, $b$  if v_plan is null and p_state ->> 'variation_id' ~ '^[A-Za-z0-9_-]{6,64}$' then
    select sp.plan_key, jsonb_build_object('amount', sp.amount, 'currency', sp.currency)
      into v_plan, v_inv
    from private.billing_square_plans sp where sp.variation_id = p_state ->> 'variation_id' limit 1;
    if v_plan is not null then
      p_state := p_state || jsonb_build_object('plan_key', v_plan) || v_inv;
      v_inv := null;
    end if;
  end if;
$b$ || v_anchor);
end;
$do$;
