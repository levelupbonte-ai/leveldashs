# LevelStudio credits

- Every LevelUp account gets **60 welcome credits once** (not every day).
  Costs: questions 1, a change 2, a site build 5 (LevelStudio `CREDIT_COSTS`).
- Then **top-ups**: 5 USD for 50 credits (`private.studio_credit_pack('starter')`).
- LevelStudio counts what an account used on one lifetime row of
  `studio_usage` (day `2000-01-01`) and allows `60 + studio_credit_grants_total(user)`.

## Buying credits

1. LevelStudio's "Buy credits" links to
   `dashboard.levelup-ecosystem.com/api/studio/credits/checkout?pack=starter`.
   Not signed in on the dashboard: sign-in first, then back to the route.
2. `studio_credit_order_create(pack)` (as the user) gives the pending order and
   the amount; a Square payment link is created (note `LevelUp credits <order id>`)
   and recorded with the billing key (`studio_credit_order_record`). Square
   brings the buyer back to `studio.levelup-ecosystem.com/settings?credits=success`.
3. The Square webhook (`/api/billing/square/webhook`) sends credit payments to
   `studio_credit_ingest_square` (order, amount, currency checked, duplicates
   ignored), which adds a row to `public.studio_credit_grants`.

Database: `20261114140000_studio_credits`. Code: `src/app/api/studio/credits/checkout`,
`src/lib/payments/square-form.ts` (`creditPaymentNote`, `toSquareCreditEvent`).
