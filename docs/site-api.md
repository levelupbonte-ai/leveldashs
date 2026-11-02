# Site API (server keys, payments, visitor analytics)

How a client website sends LevelUp what happens on it, so its dashboard shows
real data: payments (with a per-site **server key**) and visitor analytics
(through the LevelUp tag, no key). Database side: migrations
`20261024120000_site_api_keys`, `20261024120100_site_payments`,
`20261024120200_site_analytics`, `20261031100000_site_payments_providers` (see
[database.md](./database.md)).

## Server keys

| | |
|---|---|
| Format | `lu_live_<48 hex>` (real payments) or `lu_test_<48 hex>` (the provider's test / sandbox mode) |
| Created by | owners and admins of the organization, dashboard → **Developers → Server keys** (MFA when enrolled) |
| Stored | only `sha256(key)`, the prefix and the last 4 characters (`site_api_keys`); the full key is shown **once** |
| Scopes | `payments:write` (shown as “Report payments”), `events:write` (reserved for future events) |
| Limits | 10 active keys per website; 300 calls per key per 10 minutes (`PT429`) |
| Revoked | immediately refused (`PT401`); creation and revocation are written to `site_audit_log` |

A server key is a **server secret**: put it in the website's server environment
(`LEVELUP_SITE_KEY`, e.g. Vercel → Settings → Environment Variables), never in
browser code, a `NEXT_PUBLIC_*` variable or the repository.

The dashboard's **Developers** page (`/dashboard/site/developers`) shows the site ID,
environment, tag status and allowed domains, then tabs: Quick start, Forms & JavaScript,
Server keys (owners / admins: table, create shown once with an “I've stored it safely”
confirmation, revoke with confirmation), Payments (the exact endpoint, labelled
“LevelUp API endpoint”, the public key, the supported providers, the contract and its
former names, the minor-unit table, and copyable server examples for Stripe, PayPal,
Flutterwave, Paystack, CinetPay and any other provider) and Activity
(owners / admins: `site_audit_log` + the latest `site_payment_events`). Client-facing
text never names the hosting or database providers; the samples use
`LEVELUP_API_URL` / `LEVELUP_PUBLIC_KEY` / `LEVELUP_SITE_KEY`.

## Payments: `site_ingest_payment`

Provider-neutral: the website's **server** reports every payment state change,
whatever collects the money (a card checkout, an African aggregator, mobile
money, PayPal, a bank transfer, cash on delivery). Typically from the provider's
webhook / notification handler after verifying its signature, or from the
site's own order system.

```http
POST {SUPABASE_URL}/rest/v1/rpc/site_ingest_payment
apikey: {SUPABASE_PUBLISHABLE_KEY}
Content-Type: application/json

{ "p_key": "<LEVELUP_SITE_KEY>", "p_event": { …event… } }
```

`SUPABASE_URL` is `https://rncuhmvykrmtxfzqpitc.supabase.co`; the publishable key
is the same public key the websites already use. The key in `p_key` is what
authenticates the call and picks the website: the event cannot name a website.

### Providers

`provider` is one of these lowercase slugs (`private.site_payment_providers()`,
the `site_payments_provider_check` constraint and `PAYMENT_PROVIDERS` in
`src/lib/validation/site-events.ts` hold the same list):

| Kind | Slugs |
|---|---|
| Cards / global checkouts | `stripe`, `paypal`, `square`, `mollie`, `lemonsqueezy`, `paddle`, `adyen`, `braintree`, `razorpay` |
| African aggregators | `flutterwave`, `paystack`, `cinetpay`, `fedapay`, `kkiapay`, `pesapal`, `hubtel` |
| Mobile money (direct or through an aggregator) | `wave`, `mtn_momo`, `orange_money`, `mpesa`, `airtel_money`, `moov_money` |
| Offline | `bank_transfer`, `cash_on_delivery` |
| Anything else | `other` (put the name in `metadata`) |

Any other value (an unknown name, `Stripe`, `PAYPAL`, empty) is refused with `22023`.
Adding a provider = a migration that extends the function and both CHECK
constraints, plus the TypeScript list and the `insights.payments.providers.*`
labels.

### Event contract

```json
{
  "provider": "paystack",
  "provider_event_id": "charge.success:4099260516",
  "provider_payment_id": "T458123456789",
  "provider_reference": "4099260516",
  "method": "card",
  "status": "paid",
  "amount": 2500000,
  "currency": "NGN",
  "customer": { "email": "ama@example.com", "name": "Ama Owusu" },
  "offer": { "id": "starter-box", "name": "Starter box" },
  "livemode": true,
  "occurred_at": "2026-10-20T14:00:00Z",
  "metadata": {}
}
```

| Field | Rule |
|---|---|
| `provider` | required, an allow-listed slug (above) |
| `provider_event_id` | required, `[A-Za-z0-9][A-Za-z0-9_.:@/+=\|#-]{0,254}`; the same event twice (per website + provider) is ignored (`duplicate: true`). No event id at the provider: send `<payment id>:<status>` |
| `provider_payment_id` | required, same characters; the provider's payment / session / transaction id; **one payment per website + provider + id** |
| `provider_reference` | a second id (payment intent, `tx_ref`, operator id) or `null` |
| `method` | `card` \| `mobile_money` \| `bank_transfer` \| `paypal` \| `cash` \| `other` or `null`. Defaults: `paypal` → `paypal`, `cash_on_delivery` → `cash`, `bank_transfer` → `bank_transfer`, the mobile money slugs → `mobile_money` |
| `status` | `paid` \| `pending` \| `failed` \| `refunded` \| `expired` \| `cancelled` |
| `amount` | integer in the currency's **minor unit** (see below), 0 to 10^11 |
| `currency` | ISO 4217, any case (`XOF`, `usd`), stored lowercase |
| `customer` | `{ "email", "name" }` or `null`: valid email (stored lowercase), name 120 characters, no HTML; no other key |
| `offer` | `{ "id", "name" }` or `null`: id `[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}`, name 200 characters, no HTML |
| `livemode` | `true` / `false` / absent. A live key refuses an event marked `false`; a test key always records a test payment |
| `occurred_at` | ISO 8601 **with time zone**, between 2015 and now + 1 day |
| `metadata` | JSON object up to 8 KB (cleaned like form data), or `null` |

Stripe keeps its stricter formats: `provider_event_id` `evt_…`,
`provider_payment_id` `cs_…` / `pi_…` / `ch_…` / `in_…` / `py_…`, reference
`pi_…` / `ch_…` / `py_…`, and a `cs_test_` session sent with a live key is refused.

**Former names (still accepted).** Integrations written for the Stripe-only
first version keep working unchanged:

| Field | Accepted alias |
|---|---|
| `provider_payment_id` | `provider_session_id`, `provider_transaction_id` |
| `provider_reference` | `provider_payment_intent` |
| `customer` | `customer_email`, `customer_name` |
| `offer` | `offer_id`, `offer_name` |

A field and its alias in the same event are refused (ambiguous). Any other
field, a wrong type (e.g. `"amount": "260"` or `2.6`) or a value out of range is
refused with `22023` and a message naming the field.

### Amounts in minor units

`amount` is always an integer in the currency's ISO 4217 minor unit, whatever
the provider. Zero-decimal currencies have no minor unit: the amount is the
number of units.

| Exponent | Currencies | Example |
|---|---|---|
| 2 (most) | USD, EUR, CAD, GBP, NGN, GHS, KES, ZAR, MAD, … | 25.00 USD → `2500` |
| 0 | BIF, CLP, DJF, GNF, ISK, JPY, KMF, KRW, PYG, RWF, UGX, UYI, VND, VUV, **XAF**, **XOF**, XPF | 15 000 XOF → `15000`, 1 200 JPY → `1200` |
| 3 | BHD, IQD, JOD, KWD, LYD, OMR, TND | 1.234 KWD → `1234` |
| 4 | CLF, UYW | |

What the providers send: Stripe and Paystack already use minor units
(Paystack: kobo, pesewas, cents); PayPal (`"10.00"`), Flutterwave and CinetPay
send major units, so convert with `Math.round(value * 10 ** exponent)` (the
`toMinor` helper of the Developers page). For a currency a provider treats
differently from ISO 4217, check the provider's documentation. The dashboard
uses the same table (`src/features/payments/lib/money.ts`:
`ZERO_DECIMAL_CURRENCIES`, `THREE_DECIMAL_CURRENCIES`, `fractionDigits`,
`minorToMajor`, `formatMoney`), so 15000 XOF shows as “F CFA 15,000”, never
“F CFA 150.00”.

### Status changes

| From | Accepted next statuses |
|---|---|
| (new) | any |
| `pending` | `paid`, `failed`, `expired`, `cancelled` |
| `failed` | `paid`, `expired`, `cancelled` |
| `paid` | `refunded` |
| `refunded`, `expired`, `cancelled` | none (final) |

A payment never goes back from `paid` to `pending` / `failed` / `cancelled`: a
late or out-of-order event answers `200 {"ok":true,"applied":false}` (so
webhooks do not retry) and only fills details that were missing. Every event is
kept in `site_payment_events` (history in the detail drawer).

### Responses

| HTTP | Body / code | Meaning |
|---|---|---|
| 200 | `{"ok":true,"applied":true,"duplicate":false,"status":"paid"}` | recorded |
| 200 | `{"ok":true,"applied":false,"duplicate":true,…}` | same event already received |
| 401 | `PT401` | unknown, malformed or revoked key |
| 403 | `PT403` | key without `payments:write` |
| 400 | `22023` | invalid event (message names the field) |
| 429 | `PT429` | more than 300 calls in 10 minutes for this key |

### Server examples

The Developers page → Payments tab has copyable samples
(`src/features/site/components/developers/payment-snippets.ts`), all Next.js
route handlers that import one helper, `lib/levelup.ts` (`toMinor` +
`reportPayment`):

| Provider | Verifies the delivery with | Maps |
|---|---|---|
| Stripe | `stripe.webhooks.constructEvent` (`stripe-signature`) | `checkout.session.*` → status; `charge.refunded` → the session found by payment intent, `refunded` |
| PayPal | `POST /v1/notifications/verify-webhook-signature` | `PAYMENT.CAPTURE.COMPLETED / PENDING / DENIED / REFUNDED`; capture id as payment id (refund: its `up` link); `"10.00"` → minor units |
| Flutterwave | `verif-hash` header = the dashboard secret hash, then `GET /v3/transactions/{id}/verify` | `charge.completed`; `successful` / `failed` / other → `paid` / `failed` / `pending`; `payment_type` → method; major → minor units |
| Paystack | `x-paystack-signature` = HMAC SHA-512 of the raw body | `charge.success`; `reference` as payment id, `channel` → method, `domain` → `livemode`; amounts already in the subunit |
| CinetPay | the notification only triggers `POST https://api-checkout.cinetpay.com/v2/payment/check` | `ACCEPTED` / `REFUSED` / other → `paid` / `failed` / `pending`; XOF / XAF unchanged |
| Any provider | the site's own logic | an example for cash on delivery |

Where a payload differs between API versions (Flutterwave v4, Paystack
refunds), the samples say to check the provider's webhook payload instead of
guessing a field. A failed call should make the handler answer 5xx so the
provider retries; a `200` with `applied:false` is not an error.

The dashboard's TypeScript copy of the contract (same rules, aliases included)
is `src/lib/validation/site-events.ts` (`paymentEventSchema`), tested in
`site-events.test.ts`; the database suites are `supabase/tests/site_payments.sql`
(the former Stripe contract) and `payments_providers.sql` (every slug, unknown
slugs, zero-decimal currencies, aliases, idempotency across providers,
isolation, bad / revoked / wrong-scope keys).

### Who sees what

- Members of the organization (viewer and above) see the **Payments** page
  (feature `payments`, or as soon as a payment exists): KPIs per currency,
  revenue chart, top offers, table with a provider badge (and method), provider
  and method filters (only the ones in use), detail drawer. Labels are
  provider-neutral (“Payment ID”, “Reference”).
- Customer email / name and `metadata` are only returned to editors and above;
  viewers get `j***@e***.com` / `J. D.` (`site_payments_list`,
  `site_payment_detail`). The table itself never exposes those columns.
- CSV export: owners / admins (`site_payments_export`, MFA, audited, 5000 rows; same
  status / provider / method filters; columns include `provider`, `method`,
  `provider_payment_id`, `provider_reference`).

## Visitor analytics: `track_pageview`

Privacy-friendly page views for the dashboard's **Analytics** page: no cookie,
no IP address, no user agent and no visitor identifier is stored. Only daily
counters per website / path / referrer host / language
(`site_traffic_daily`, `site_pageviews_daily`).

```http
POST {SUPABASE_URL}/rest/v1/rpc/track_pageview
{ "p_website_id": "ws_…", "p_path": "/pricing?x=1", "p_referrer": "https://www.google.com/", "p_lang": "fr-CA" }
```

- Counted only for a live website when the browser `Origin` is one of its
  allowed origins (like the other public functions); bots are skipped; it
  answers `true` / `false`, never an error.
- Paths are normalised: no query or fragment, lowercase, ids / long numbers /
  tokens / e-mail-like segments become `:id`, 200 characters, at most 500
  distinct paths a day (the rest is `/(other)`).
- Referrers keep the host only (`google.com`); internal navigation is "direct".
- Unique visitors: a random salt of the day (replaced when the day changes) and
  a daily bit set per website; nothing can be traced back to a person.
- Rate limit: 60 views per 5 minutes per visitor bucket, 200 000 views a day per
  website.

### Wiring the LevelUp tag (to do in `app.levelup-ecosystem`)

The tag calls `https://levelup-ecosystem.com/api/v1/<action>`, which forwards to
the platform. Two small changes:

1. `src/app/api/v1/[action]/route.ts`: add the action and forward the visitor
   address and browser (the platform sees the proxy otherwise):

   ```ts
   pageview: { fn: 'track_pageview', args: { ...SITE, path: 'p_path', referrer: 'p_referrer', lang: 'p_lang' } },
   ```

   with a `v1Bodies.pageview` schema (`path` string ≤ 2000, `referrer` string
   ≤ 2000 optional, `lang` string ≤ 35 optional), and for this action pass
   `headers: { 'x-lu-client-ip': clientIp(request.headers), 'x-lu-client-ua': request.headers.get('user-agent')?.slice(0, 400) ?? '' }`
   to `callPlatform` (next to `origin`). Not a write: no honeypot.

2. `public/sdk/v1/levelup.js` (bump `VERSION`), next to the existing `ping`:

   ```js
   function pageview() {
     call('pageview', {
       path: location.pathname + location.search,
       referrer: document.referrer || null,
       lang: navigator.language || null
     }).catch(function () {});
   }
   pageview();
   // Single-page apps: count client-side navigations too.
   ['pushState', 'replaceState'].forEach(function (m) {
     var original = history[m];
     history[m] = function () {
       var before = location.pathname;
       var result = original.apply(this, arguments);
       if (location.pathname !== before) pageview();
       return result;
     };
   });
   window.addEventListener('popstate', pageview);
   ```

   Respect `data-analytics="off"` on the script tag to let a site opt out.

Until then the Analytics page shows "Install / update the LevelUp tag to see
visitors".

## Adaptive dashboard reads

| Function | Used by |
|---|---|
| `site_capabilities(website)` | navigation (items with `data`), "Everything on my site", overview |
| `site_overview_stats(website, days)` | overview (7 / 30 / 90 days) |
| `site_recent_activity(website)` | header bell |
| `site_submissions_list(website, type, statuses, search, limit, offset)` | Forms & requests (any form type) |
| `site_project_requests_list / _stats / site_update_project_request` | LevelUp only (feature `project_requests`) |
| `site_studio_summary` | LevelUp only (feature `studio_insights`): aggregate LevelStudio usage |

All are `SECURITY INVOKER` (RLS decides) except the payment readers and the
LevelUp-own sources, which check membership (+ MFA) themselves.

Custom forms: `submit_form` accepts any form type matching
`^[a-z][a-z0-9_]{1,39}$` (e.g. `volunteer_signup`) on a website with
`contact_form`; `quote`, `newsletter` and `vip_signup` keep their own feature.
The inbox detects each form's fields from its data.
