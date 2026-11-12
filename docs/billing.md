# Billing: invoices, receipts, storage limit, online payments

Plans, prices, discounts and charges are described in
[database.md → Billing](./database.md#billing-plans-and-limits-billing_). This page covers
what was added on top: real invoice and receipt PDFs, the plan storage limit, and online
payment of LevelUp's invoices (shipped **switched off**).

Migrations: `20261026130000_billing_invoices.sql`, `20261026130100_media_storage_limit.sql`,
`20261026130200_billing_online_payments.sql`, `20261031120000_billing_square.sql`. Test suites:
`supabase/tests/invoices.sql`, `supabase/tests/billing_square.sql` (rolled back, must report
`0 failed`).

## Invoices and receipts

**Numbers.** Every charge gets an invoice number when it is issued (inserted):
`LU-2026-0001`, `LU-2026-0002`, … sequential and gap-free per issuer and calendar year
(America/Toronto). The trigger `billing_charges_invoice_number` takes the next number from
`private.invoice_counters` with a `select … for update` lock on the counter row, inside the
transaction that inserts the charge: a refused charge rolls its number back, two staff
creating charges at the same time wait for each other, never `max() + 1`. A number given
by the caller is ignored; numbers, issuer and issue date never change afterwards
(`billing_charges_keep_number`). A voided charge keeps its number; its invoice shows
**Void** with a watermark.

**Issuer.** LevelUp's legal name, address, billing e-mail and optional tax / registration
number live in one row, `public.billing_issuers` (key `levelup`, prefix `LU`). It ships
**empty**: nothing is invented. Staff fill it on *LevelUp → Billing → Business details on
invoices* (`admin_save_billing_issuer`, aal2, audited `billing.issuer_updated`). Until the
legal name, address and e-mail are set:

- staff see **"Complete your business details before sending invoices"** (admin Billing
  screen and the organization's billing sheet);
- clients see no Invoice / Receipt buttons and the PDF routes answer `409`;
- staff can still preview a PDF; it carries a *Draft* strip.

Documents always show the issuer's current details.

**Receipts.** When staff mark a charge paid (`admin_record_charge_payment`) they record the
method (`bank_transfer`, `cash`, `mobile_money`, `card`, `other`), the paid date (stored at
noon America/Toronto, so the date never shifts) and an optional reference. A paid charge
has a receipt. Online payments record `card`, the Stripe payment / session id as the
reference, and the amount paid. The older `admin_mark_charge_paid` still works and records
method `other`.

**PDFs.** `GET /api/billing/charges/[id]/invoice` and `/receipt` (route handlers, Node).
They call `billing_charge_document(id)` as the signed-in user: owners and admins of the
charge's organization, and LevelUp staff on aal2; anyone else (viewers, editors, other
organizations, unknown ids) gets the same `404`. The PDF is generated on every request
with **pdf-lib** and the standard fonts, like the contract PDF
(`src/features/billing/server/pdf.ts`), in the reader's language (`emails.billingDocument`
messages, English or French). Invoice: issuer, client organization, number, issue and due
dates, line, discount, total, currency, status. Receipt: the same plus payment date,
method and reference. Files are named `invoice-LU-2026-0001.pdf` /
`facture-LU-2026-0001.pdf`, `Cache-Control: private, no-store`.

Clients download them from **Billing → What you owe** (Invoice / Receipt per charge, owners
and admins only: the database never returns charges to editors and viewers). Staff use
the buttons in the organization's billing sheet.

## Changing plan: paid online

In Billing → Plans, an owner or admin who picks a plan **with a price**
(`plans.price_monthly` > 0, set by LevelUp in HQ) while online payments are on
gets a dialog with the monthly price and one button per payment method (card,
PayPal). `billing_plan_charge(org, plan)` creates the charge for the first month
(`kind` subscription, `plan_key` set, best discount applied; the same charge is
reused while it waits for payment, and an unpaid charge for another plan is
voided), then the usual checkout opens the payment page. When the payment is
recorded, the trigger `billing_charges_plan_paid` moves the organization to the
plan (`organization_billing`: plan, status active, next due date in one month,
custom price cleared) and approves a pending upgrade request.

A plan without a price (`Price set by LevelUp`), the free plan, or online
payments off keep the request flow (`request_plan_upgrade`, e-mail to the team).

## Storage limit (plan `limits.media_mb`)

One number for the meter, the usage panel and the checks: `private.org_storage(org)` now
reads `private.org_storage_usage(org)` (the stored objects: media library with thumbnails,
both layouts, plus organization logos). The limit is enforced in three places, all with
the same rule (`used + new > media_mb MB` → `plan_limit_reached`, errcode `PT402`, detail
`{"key": "media_mb", "limit", "plan"}`):

1. `media_check_upload(website, bytes)`: the dashboard asks before uploading (file +
   thumbnail).
2. The Storage insert policy `media_objects_insert` (`private.media_quota_open`): refuses a
   new object once the organization is already at or over its limit — the backstop for
   direct API calls (a policy cannot know the size of the file being uploaded).
3. The media index trigger `media_before_insert` (registration): the authoritative check,
   with the sizes Storage really stored. The dashboard removes the uploaded objects when
   it refuses.

The media library shows the same upgrade notice as the team and assistant limits
(*Your plan allows N MB of media storage. Upgrade to do more.* + link to Billing). Existing
files stay readable, listed and deletable over the limit. Trusted tooling without a user
(`scripts/migrate-media.mjs`) is not limited, like the role check of the same trigger.

## Online payments (Stripe Checkout or Square) — off by default

LevelUp's Stripe account is under review, so this ships **switched off** and is safe with
no keys: the "Pay online" button is hidden and the payment routes answer `404`. Two
providers are built: **Stripe Checkout** and **Square payment links** (US-native, works for
sole proprietors). Clients see the same "Pay online" button whichever is used; nothing
client-facing names the provider (staff see it on the admin Billing card).

**Which provider.** `LEVELUP_PAYMENT_PROVIDER=stripe|square` picks one (its keys must be
complete, otherwise payments stay off). Unset: the provider whose keys are complete, Stripe
when both are. Each webhook route keeps working while its own keys are set, so events of
the previous provider are still recorded after a switch.

**Pieces.**

| Piece | Where |
|---|---|
| Provider abstraction (`PaymentProvider`: create / get / expire a checkout) | `src/lib/payments/types.ts` |
| Stripe implementation, REST over `fetch` (no SDK), `import 'server-only'` | `src/lib/payments/stripe.ts` |
| Square implementation (payment links + orders), REST over `fetch`, `import 'server-only'` | `src/lib/payments/square.ts` |
| Switch: `LEVELUP_ONLINE_PAYMENTS=on`, the billing key **and** the chosen provider's keys well formed; provider selection | `src/lib/payments/config.ts`, `onlinePaymentsEnabled()` in `src/lib/payments/index.ts` |
| Stripe signature (HMAC-SHA256 of `t.raw_body`, 5 min tolerance, timing-safe) | `src/lib/payments/stripe-signature.ts` |
| Square signature (base64 HMAC-SHA256 of notification URL + raw body, timing-safe) | `src/lib/payments/square-signature.ts` |
| Event mapping, deterministic checkout parameters | `stripe-events.ts`, `stripe-form.ts`, `square-form.ts` (unit tests: `payments.test.ts`, `square.test.ts`) |
| `POST /api/billing/charges/[id]/checkout` | owners / admins, same origin |
| `POST /api/billing/stripe/webhook` | Stripe only (signature) |
| `POST /api/billing/square/webhook` | Square only (signature) |

**Checkout.** The route calls `billing_checkout_prepare(charge)` as the signed-in user: it
checks the role (owner or admin of the charge's organization) and the status (due or
overdue), locks the charge and returns the **exact amount and currency of the charge**; the
browser only sends the charge id. One attempt per charge at a time
(`private.billing_checkouts`): while it is open, a second click gets the same attempt, so
the same Stripe idempotency key (`levelup-charge-<id>-<attempt>`) and byte-identical
parameters (no clock, locale or e-mail in them) → Stripe returns the same session. Once the
session is recorded (`billing_checkout_record`) the route hands back its URL. A new attempt
is only opened after the previous one expired, and the route expires the previous session
first, so two sessions are never payable at once. Metadata on the session and on the
payment intent: `charge_id`, `organization_id`, `invoice_number`. Success and cancel URLs
go back to `/dashboard/billing?payment=success|cancelled`.

**Webhook.** The route reads the raw body, verifies `Stripe-Signature` with
`LEVELUP_STRIPE_WEBHOOK_SECRET`, ignores events of the other mode (a `sk_test_` key only
accepts test events, `sk_live_` only live ones) and calls
`billing_ingest_stripe_event(key, event)`:

- `checkout.session.completed` / `async_payment_succeeded` with `payment_status = paid`:
  the charge must exist, belong to the organization in the metadata, still be due, and the
  **amount and currency must match** the charge. Then it is marked paid: method `card`,
  provider `stripe`, the session id, the payment intent as reference, the amount paid.
- duplicates are ignored: the provider event id is unique (`billing_payment_events`) and a
  charge is paid only once (`already_paid`);
- mismatches, payments of a void or already paid charge and unknown charges are recorded
  and audited (`billing.online_payment_*`) for a human to refund — never applied;
- `checkout.session.expired` closes the attempt, so the next click opens a new session.

Every event is kept in `public.billing_payment_events` (staff read). The route answers 2xx
once the event is recorded or deliberately ignored, 5xx when Stripe should retry.

### Server-to-database authentication: the billing webhook key

There is no Supabase secret key in this app, and there must be none. The webhook has no
user session (it runs as `anon` with the publishable key, `src/lib/supabase/anon.ts`), so
the database function authenticates the call itself, the same way `site_ingest_payment`
checks a per-site server key:

- the **billing webhook key** is `lu_bill_` + 48 hex characters (192 random bits), made by
  `admin_create_billing_webhook_key()` — staff only, aal2, audited, rate limited;
- it is returned **once**; the database keeps only its SHA-256
  (`private.billing_webhook_keys`, closed to every API role) and a 4-character hint;
- one key is active at a time: generating a new one revokes the previous one at once;
- the server keeps it in `LEVELUP_BILLING_KEY`; `billing_ingest_stripe_event` hashes the
  key it receives and refuses anything else (`invalid_key`, `PT401`). It is executable by
  `anon` only (signed-in users cannot call it), so it can only be used with the key, and
  the key only lives on the server next to the Stripe webhook secret;
- the Stripe signature proves the event comes from Stripe; the key proves the database call
  comes from this route. Neither the key nor the Stripe secrets are ever logged or sent to
  the browser (no `NEXT_PUBLIC_`).

Staff generate (or replace) the key on *LevelUp → Billing → Online payments → Generate a
key*; the dialog shows it once with a Copy button.

### Turning on online payments

1. **Stripe:** once the account is approved, *Developers → API keys*: create a **restricted
   key** (`rk_live_…`) with *Checkout Sessions: write* (or use the secret key `sk_live_…`).
2. **Stripe:** *Developers → Webhooks → Add endpoint*:
   - URL `https://dashboard.levelup-ecosystem.com/api/billing/stripe/webhook`
   - events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`
   - copy its **signing secret** (`whsec_…`).
3. **Dashboard:** *LevelUp → Billing → Online payments → Generate a key* (staff, aal2), copy
   the `lu_bill_…` key.
4. **Vercel** (project *leveldashs*, Production, **not** `NEXT_PUBLIC_`, mark them
   *Sensitive*):

   ```env
   LEVELUP_ONLINE_PAYMENTS=on
   LEVELUP_STRIPE_SECRET_KEY=rk_live_...        # or sk_live_...
   LEVELUP_STRIPE_WEBHOOK_SECRET=whsec_...
   LEVELUP_BILLING_KEY=lu_bill_...
   ```

5. Redeploy. The admin card shows **On**; owners and admins see **Pay online** on charges
   due. Test first with test-mode keys (`sk_test_…`, a test webhook endpoint and its
   `whsec_…`) on a preview deployment: test keys only accept test events.

To switch off: remove `LEVELUP_ONLINE_PAYMENTS` (or set it to anything but `on`) and
redeploy; to rotate the billing key, generate a new one and update `LEVELUP_BILLING_KEY`
right away (Stripe retries failed webhooks for three days).

### Square payment links

**Checkout.** Same route, same database preparation (`billing_checkout_prepare`: role,
status, exact amount, one attempt at a time). The route creates a payment link
(`POST /v2/online-checkout/payment-links`, `quick_pay` with the charge's name, its amount in
cents and the location) with the idempotency key `levelup-charge-<id>-<attempt>` and a
byte-identical body for one attempt, so a double click gets the same link back. Tipping is
off; after paying, Square redirects to `/dashboard/billing?payment=success`. The payment
note `LevelUp <invoice number> charge <charge id>` is copied by Square onto the payment.
`billing_checkout_record_square` records the link on the attempt and its **order id** in
`private.billing_square_orders` (closed to every API role; every order ever created for a
charge is kept, so a late payment of an older link still maps back). Square links do not
expire by themselves: when an attempt is replaced, the route deletes the previous link,
which cancels its order (a link already paid is reported, never replaced).

**Webhook.** `POST /api/billing/square/webhook` reads the raw body and verifies
`x-square-hmacsha256-signature`: base64 of HMAC-SHA256 over the **notification URL + raw
body** with `LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY`, compared in constant time. The URL is
`LEVELUP_SQUARE_WEBHOOK_URL` when set, otherwise the URL the request came in on (they must
be byte-identical to the subscription's URL). Only `payment.created` / `payment.updated`
for the configured location, with an order and the LevelUp payment note, are passed on;
everything else answers `200 ignored` (the location's other sales are not billing's
business). `billing_ingest_stripe_event(key, { provider: 'square', … })` then:

- finds the charge through **our record of the order** (never the payload alone); a payment
  note naming another charge is refused;
- applies only `status = COMPLETED`, with `amount_money` (cents, tips excluded) and the
  currency equal to the charge's: method `card`, provider `square`, the order id as
  session, the **payment id** as reference, the amount paid;
- ignores duplicates: the same event id twice, and later notifications about the payment
  already applied (`duplicate`); a second, different payment of a paid charge, a payment of
  a void charge, an amount or currency mismatch and an unknown order are recorded and
  audited (`billing.online_payment_*`, metadata `provider: square`) for a human to refund.

Square has no test flag on events: sandbox and production are separate applications with
separate keys and webhook subscriptions (`LEVELUP_SQUARE_ENV`).

### Turning on Square

1. **Square Developer Console** (<https://developer.squareup.com/apps>, sign in with the
   Square account that receives the money): *Create an application* (e.g. "LevelUp
   invoices").
2. In the application, switch to **Production** at the top:
   - *Credentials* → copy the **Production access token** (`EAAA…`);
   - *Locations* → copy the **Location ID** of the business location that should receive
     the payments (`L…`).
3. Still in Production, *Webhooks* → *Subscriptions* → *Add subscription*:
   - URL `https://dashboard.levelup-ecosystem.com/api/billing/square/webhook`
   - API version: the latest offered
   - event `payment.updated` (adding `payment.created` is harmless)
   - save, then open the subscription and copy its **Signature key**.
4. **Dashboard:** *LevelUp → Billing → Online payments → Generate a key* (staff, aal2), copy
   the `lu_bill_…` key (skip if `LEVELUP_BILLING_KEY` is already set: the same key serves
   both providers).
5. **Vercel** (project *leveldashs*, Production, **not** `NEXT_PUBLIC_`, mark each one
   *Sensitive*):

   ```env
   LEVELUP_ONLINE_PAYMENTS=on
   LEVELUP_PAYMENT_PROVIDER=square
   LEVELUP_SQUARE_ACCESS_TOKEN=EAAA...
   LEVELUP_SQUARE_LOCATION_ID=L...
   LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY=...
   LEVELUP_SQUARE_ENV=production
   LEVELUP_BILLING_KEY=lu_bill_...
   # Optional: the exact subscription URL, if the deployment is reached through another host
   # LEVELUP_SQUARE_WEBHOOK_URL=https://dashboard.levelup-ecosystem.com/api/billing/square/webhook
   ```

6. Redeploy. The admin Billing card shows **On** and *Provider for new payments: Square*;
   owners and admins see **Pay online** on charges due.

**Test in the sandbox first, on a preview deployment.** In the Developer Console switch to
**Sandbox**: copy the sandbox access token and the sandbox location ID, add a sandbox
webhook subscription whose URL is the preview deployment's
`https://<preview-host>/api/billing/square/webhook` (event `payment.updated`) and copy its
signature key. Put these in Vercel's **Preview** environment with
`LEVELUP_SQUARE_ENV=sandbox` (and the same `LEVELUP_ONLINE_PAYMENTS=on`,
`LEVELUP_PAYMENT_PROVIDER=square`, `LEVELUP_BILLING_KEY`). Vercel preview deployments sit
behind Vercel Authentication by default: give Square a way in (a *Protection Bypass for
Automation* secret in the URL, or a preview without protection), and set
`LEVELUP_SQUARE_WEBHOOK_URL` to exactly the URL registered on the subscription. Pay a test
charge with Square's sandbox test card (`4111 1111 1111 1111`, any future date, any CVV);
the charge turns **Paid** and its receipt shows the card payment. Then do the production
steps above.

To switch off: remove `LEVELUP_ONLINE_PAYMENTS` (or set it to anything but `on`) and
redeploy. To go back to Stripe: set `LEVELUP_PAYMENT_PROVIDER=stripe` with the Stripe keys;
keep the Square keys until open Square links are paid or deleted, so their webhooks are
still recorded.

### What the payment page shows

The item reads `LevelUp Ecosystem — <label> (<invoice number>)`; the signed-in payer's
e-mail is pre-filled (Square `pre_populated_data`, PayPal `email_address`); LevelUp's
billing e-mail (*Billing → business details*, `billing_issuers.email`) is shown as the
support address on Square; Apple Pay, Google Pay and Cash App Pay are offered on Square
(each appears only where the device and the Square account allow it). Logo and brand
colour are set in the providers' own dashboards (Square: *Settings → Account &
Settings → Business → Brand*; PayPal: business profile), not in code.

### PayPal (beside the card provider, or alone)

When the PayPal keys are set, the charge shows **Pay by card** (Stripe or Square) and
**PayPal**; with PayPal alone, only **PayPal**. Code: `src/lib/payments/paypal.ts` (Orders
v2 over `fetch`), `paypal-form.ts` (pure, tested), `paypal-capture.ts`, routes
`/api/billing/paypal/return` and `/api/billing/paypal/webhook`; database
`20261113170000_billing_paypal`.

Flow: the checkout route creates a PayPal order for the charge's current attempt
(`billing_checkout_record_paypal`, session id `pp_<order id>`, `invoice_id` = invoice
number, so PayPal refuses to be paid twice for one invoice). The payer approves on PayPal
and comes back to `/api/billing/paypal/return`, which **captures** the order and records
it. A payer who closes the tab is covered by the `CHECKOUT.ORDER.APPROVED` webhook, which
captures too. An order is only captured while its charge is still due
(`billing_paypal_order_check`, billing key), so an old order approved late never takes
money for a paid invoice. The capture goes through `billing_ingest_stripe_event`
(`provider: 'paypal'`): the charge comes from our own record of the order, the amount and
currency must match, duplicates (return page + webhook) are ignored. The charge becomes
**Paid** with method *PayPal*.

Switching between card and PayPal on one charge closes the other attempt first
(`billing_checkout_restart`).

### Turning on PayPal

1. **PayPal Developer Dashboard** (<https://developer.paypal.com/dashboard/>, log in with
   the PayPal **Business** account that receives the money) → *Apps & Credentials* →
   **Live** → *Create App* (type *Merchant*, e.g. "LevelUp invoices"). Copy the **Client ID**
   and the **Secret**.
2. In the app → *Webhooks* → *Add webhook*:
   - URL `https://dashboard.levelup-ecosystem.com/api/billing/paypal/webhook`
   - events: `Checkout order approved`, `Payment capture completed`,
     `Payment capture pending`, `Payment capture denied`
   - save and copy the webhook's **ID**.
3. **Vercel** (project *leveldashs*, Production, **not** `NEXT_PUBLIC_`, *Sensitive*):

   ```env
   LEVELUP_ONLINE_PAYMENTS=on
   LEVELUP_BILLING_KEY=lu_bill_...        # same key as for cards
   LEVELUP_PAYPAL_CLIENT_ID=...
   LEVELUP_PAYPAL_CLIENT_SECRET=...
   LEVELUP_PAYPAL_WEBHOOK_ID=...
   LEVELUP_PAYPAL_ENV=production
   # LEVELUP_PAYMENT_PROVIDER=square       # the card provider (or 'paypal' for PayPal only)
   ```

4. Redeploy. Owners and admins see **Pay by card** and **PayPal** on charges due.

**Sandbox first**: the same steps under *Sandbox* in the Developer Dashboard (sandbox
app, sandbox webhook on the preview deployment's URL), `LEVELUP_PAYPAL_ENV=sandbox` in
Vercel's **Preview** environment, and pay with a *Sandbox → Accounts* personal test
account.
