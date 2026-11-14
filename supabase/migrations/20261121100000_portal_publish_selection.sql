-- Publish to a chosen list of members (audience 'customers'): the team picks
-- members one by one or a smart group (country, project, dossier to redo) in
-- the dashboard. 1 to 200 members of the same website; only they see the item
-- and get the e-mail. Functions are patched in place (each patch raises when its
-- anchor text is not found, so nothing is half-applied).
-- Applied as migration portal_publish_selection.

alter table public.portal_items add column if not exists customer_ids uuid[];
alter table public.portal_items drop constraint if exists portal_items_audience_check;
alter table public.portal_items add constraint portal_items_audience_check
  check (audience = any (array['customer', 'customers', 'offer', 'all']));
alter table public.portal_items drop constraint if exists portal_items_customer_ids_check;
alter table public.portal_items add constraint portal_items_customer_ids_check
  check ((audience = 'customers') = (customer_ids is not null)
         and (customer_ids is null or cardinality(customer_ids) between 1 and 200));

do $$
declare
  d text;
  procedure_patch record;
begin
  -- 1. Who sees an item.
  d := pg_get_functiondef('private.portal_item_visible'::regproc);
  if position('or (p_item.audience = ''customer'' and p_item.customer_id = p_customer_id)' in d) = 0 then
    raise exception 'portal_item_visible: anchor not found';
  end if;
  d := replace(d, 'or (p_item.audience = ''customer'' and p_item.customer_id = p_customer_id)',
    'or (p_item.audience = ''customer'' and p_item.customer_id = p_customer_id)
      or (p_item.audience = ''customers'' and p_customer_id = any (p_item.customer_ids))');
  execute d;

  -- 2. The member's home.
  d := pg_get_functiondef('public.portal_home'::regproc);
  if position('or (i.audience = ''customer'' and i.customer_id = c.id)' in d) = 0 then
    raise exception 'portal_home: anchor not found';
  end if;
  d := replace(d, 'or (i.audience = ''customer'' and i.customer_id = c.id)',
    'or (i.audience = ''customer'' and i.customer_id = c.id)
                 or (i.audience = ''customers'' and c.id = any (i.customer_ids))');
  execute d;

  -- 3. The team's overview lists the chosen members.
  d := pg_get_functiondef('public.portal_admin_overview'::regproc);
  if position('''customer_id'', i.customer_id,' in d) = 0 then
    raise exception 'portal_admin_overview: anchor not found';
  end if;
  d := replace(d, '''customer_id'', i.customer_id,', '''customer_id'', i.customer_id, ''customer_ids'', i.customer_ids,');
  execute d;

  -- 4. Publishing.
  d := pg_get_functiondef('public.portal_admin_publish'::regproc);
  for procedure_patch in
    select * from (values
      ('v_customer uuid;', 'v_customer uuid; v_customers uuid[];'),
      ('not in (''customer'', ''offer'', ''all'')', 'not in (''customer'', ''customers'', ''offer'', ''all'')'),
      ('  elsif v_aud = ''offer'' then
    v_offer := p_item ->> ''offer_id'';',
       '  elsif v_aud = ''customers'' then
    if jsonb_typeof(p_item -> ''customer_ids'') is distinct from ''array''
       or jsonb_array_length(p_item -> ''customer_ids'') not between 1 and 200 then
      raise exception ''Invalid item: customers'' using errcode = ''22023'';
    end if;
    select array_agg(distinct c.id) into v_customers
    from public.portal_customers c
    where c.website_id = p_website_id and c.deleted_at is null
      and c.id::text in (select jsonb_array_elements_text(p_item -> ''customer_ids''));
    if v_customers is null or cardinality(v_customers) <>
       (select count(distinct x) from jsonb_array_elements_text(p_item -> ''customer_ids'') x) then
      raise exception ''Invalid item: customers'' using errcode = ''22023'';
    end if;
  elsif v_aud = ''offer'' then
    v_offer := p_item ->> ''offer_id'';'),
      ('kind, audience, customer_id, offer_id, title,', 'kind, audience, customer_id, customer_ids, offer_id, title,'),
      ('v_kind, v_aud, v_customer, v_offer, v_title,', 'v_kind, v_aud, v_customer, v_customers, v_offer, v_title,'),
      ('or (v_aud = ''customer'' and c.id = v_customer)', 'or (v_aud = ''customer'' and c.id = v_customer)
           or (v_aud = ''customers'' and c.id = any (v_customers))'),
      ('''customer_id'', v_customer, ''offer_id'', v_offer,', '''customer_id'', v_customer, ''customers'', cardinality(v_customers), ''offer_id'', v_offer,')
    ) as t(anchor, repl)
  loop
    if position(procedure_patch.anchor in d) = 0 then
      raise exception 'portal_admin_publish: anchor not found: %', left(procedure_patch.anchor, 60);
    end if;
    d := replace(d, procedure_patch.anchor, procedure_patch.repl);
  end loop;
  execute d;
end $$;
