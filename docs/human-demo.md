# Human demo (19 USD, non-refundable)

A visitor who describes a project on levelup-ecosystem.com ("Start a project")
chooses at the end between:

- **LevelStudio (AI)**: the AI builds a draft in the studio (its own limits and fees);
- **A demo made by LevelUp**: 19 USD, non-refundable. The project is **sent to
  the team only once paid**; the visitor then lands on a waiting / tracking page.

## Flow

1. Showcase `/api/project-brief`: `submit_project_request`, then
   `project_demo_start(id, token)` → tracking code `LU-XXXXXX` + token. The AI
   qualification also returns an estimate (`estimate.min_days` ≥ 3, `max_days`),
   stored by `record_project_qualification`. No team e-mail at this stage.
2. "Pay and send my project" links to
   `dashboard.levelup-ecosystem.com/api/demo/checkout?c=<code>&k=<token>` (no
   session): `demo_checkout_prepare` (billing key) gives the amount
   (`private.demo_price()`, 1900 usd), a Square payment link is created (note
   `LevelUp demo <code> request <id>`), `demo_checkout_record` keeps the order.
   An open link is reused; Square brings the payer back to the tracking page.
3. Square webhook (`/api/billing/square/webhook`): a demo note goes to
   `demo_ingest_square` (order, amount, currency checked; duplicates ignored):
   paid → status `paid`, earliest date = today + max(3, AI minimum) days. Then
   the client gets the tracking link (`emails.demoPaid`) and the team an alert
   (`emails.demoPaidTeam`).
4. Dashboard → Website → Project requests → the request: **Human demo** panel.
   Owners/admins pick the step (`paid`, `analysis`, `design`, `build`,
   `final_check`, `ready`, `cancelled`), a message to the client, the demo link
   (required for `ready`) and the planned date (`site_demo_update`, MFA, audited);
   the client is e-mailed (`emails.demoStatus`) unless unticked.
5. Tracking page `levelup-ecosystem.com/suivi/<code>?k=<token>`: `demo_tracking`
   (publishable key, rate limited) — step, timeline, estimate, date, demo link
   once ready. Refreshes on its own.

Database: `20261114120000_human_demo` (`project_requests.demo_*`, `estimate_*`,
`private.project_demo_tracking`, `private.project_demo_events`).
Code: `src/app/api/demo/checkout`, `src/lib/demo/*`, `src/lib/payments/square-form.ts`
(`demoPaymentNote`, `toSquareDemoEvent`), `src/features/project-requests/components/demo-panel.tsx`.
