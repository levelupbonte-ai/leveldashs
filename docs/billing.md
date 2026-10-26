# Billing: invoices, receipts, storage limit, online payments

Plans, prices, discounts and charges are described in
[database.md → Billing](./database.md#billing-plans-and-limits-billing_). This page covers
what was added on top: real invoice and receipt PDFs, the plan storage limit, and online
payment of LevelUp's invoices (shipped **switched off**).

Migrations: `20261026130000_billing_invoices.sql`, `20261026130100_media_storage_limit.sql`,
`20261026130200_billing_online_payments.sql`. Test suite: `supabase/tests/invoices.sql`
(rolled back, must report `0 failed`).

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

## Online payments (Stripe Checkout) — off by default

LevelUp's Stripe account is under review, so this ships **switched off** and is safe with
no keys: the "Pay online" button is hidden and both routes answer `404`.

**Pieces.**

| Piece | Where |
|---|---|
| Provider abstraction (`PaymentProvider`: create / get / expire a checkout) | `src/lib/payments/types.ts` |
| Stripe implementation, REST over `fetch` (no SDK), `import 'server-only'` | `src/lib/payments/stripe.ts` |
| Switch: `LEVELUP_ONLINE_PAYMENTS=on` **and** every key well formed | `src/lib/payments/config.ts`, `onlinePaymentsEnabled()` in `src/lib/payments/index.ts` |
| Signature check (HMAC-SHA256 of `t.raw_body`, 5 min tolerance, timing-safe) | `src/lib/payments/stripe-signature.ts` |
| Event mapping, deterministic checkout parameters | `stripe-events.ts`, `stripe-form.ts` (unit tests: `payments.test.ts`) |
| `POST /api/billing/charges/[id]/checkout` | owners / admins, same origin |
| `POST /api/billing/stripe/webhook` | Stripe only (signature) |

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
