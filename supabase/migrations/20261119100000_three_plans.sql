-- The three monthly plans, the same everywhere (dashboard billing, invoices,
-- the public pricing page through levelup_offer()): Essential 39, Pro 99,
-- Premium 199 USD. The 199 plan (key `business`) is offered again, under the
-- name the website uses. Free stays the starting plan of every new site.
-- Applied as migration three_plans.
update public.plans set listed = true, name = 'Premium', sort_order = 30 where key = 'business';
