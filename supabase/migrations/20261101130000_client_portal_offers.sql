-- Client portal: offer groups of the website's catalog.
--
-- portal_admin_overview lists the offers declared in the feature config
-- (`website_features.config.offers`, set by LevelUp) before any payment exists,
-- then the offers seen in payments, so an owner can publish to an offer group
-- from day one. Black Pater's three offers (shared/offers.js on its site).

update public.website_features
set config = config || jsonb_build_object('offers', jsonb_build_array(
  jsonb_build_object('id', 'accompagnement-voyage', 'name', 'Solo'),
  jsonb_build_object('id', 'accompagnement-voyage-duo', 'name', 'Duo'),
  jsonb_build_object('id', 'accompagnement-voyage-famille', 'name', 'Famille')))
where website_id = 'ws_ab9493c5857ed460' and feature_key = 'client_portal';

-- Customers (with payments and offers), published items, queue state.
create or replace function public.portal_admin_overview(p_website_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := private.portal_manage_site(p_website_id);
  return jsonb_build_object(
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'email', c.email, 'name', c.name, 'source', c.source, 'status', c.status,
        'locale', c.locale, 'offer_id', c.offer_id, 'created_at', c.created_at,
        'last_sign_in_at', c.last_sign_in_at,
        'offers', to_jsonb(private.portal_customer_offers(c.id)),
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object('id', p.id, 'offer_id', p.offer_id, 'offer_name', p.offer_name,
                                              'status', p.status, 'amount', p.amount, 'currency', p.currency,
                                              'paid_at', p.paid_at, 'occurred_at', p.occurred_at)
                           order by p.occurred_at desc)
          from public.site_payments p
          where p.website_id = c.website_id and lower(p.customer_email) = any (c.payment_emails || c.email)
            and p.status in ('paid', 'refunded', 'pending')), '[]'::jsonb),
        'unread', (select count(*) from public.portal_messages m
                   where m.customer_id = c.id and m.sender = 'customer' and m.read_at is null),
        'last_message_at', (select max(created_at) from public.portal_messages m where m.customer_id = c.id))
        order by c.created_at desc)
      from public.portal_customers c where c.website_id = p_website_id), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.ord, x.id)
      from (
        select distinct on (id) id, name, ord from (
          select o ->> 'id' as id, o ->> 'name' as name, 0 as ord
          from public.website_features f, jsonb_array_elements(coalesce(f.config -> 'offers', '[]'::jsonb)) o
          where f.website_id = p_website_id and f.feature_key = 'client_portal'
            and jsonb_typeof(o) = 'object' and o ->> 'id' ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'
          union all
          select offer_id, offer_name, 1 from public.site_payments
          where website_id = p_website_id and offer_id is not null
        ) all_offers
        order by id, ord
      ) x), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'audience', i.audience, 'customer_id', i.customer_id,
        'offer_id', i.offer_id, 'title', i.title, 'body', i.body, 'trip', i.trip,
        'checklist', i.checklist, 'document_name', i.document_name, 'document_path', i.document_path,
        'document_size', i.document_size, 'status', i.status, 'published_at', i.published_at,
        'reads', (select count(*) from public.portal_item_states s where s.item_id = i.id and s.read_at is not null))
        order by i.published_at desc)
      from (select * from public.portal_items where website_id = p_website_id
            order by published_at desc limit 200) i), '[]'::jsonb),
    'outbox', (select jsonb_build_object(
        'pending', count(*) filter (where status in ('pending', 'sending')),
        'failed', count(*) filter (where status = 'failed'),
        'sent', count(*) filter (where status = 'sent'))
      from private.portal_outbox where website_id = p_website_id),
    'notify_url', (select config ->> 'notify_url' from public.website_features
                   where website_id = p_website_id and feature_key = 'client_portal'),
    'can_manage', true);
end;
$$;
