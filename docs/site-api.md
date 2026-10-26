# Site API (server keys, payments, visitor analytics)

How a client website sends LevelUp what happens on it, so its dashboard shows
real data: payments (with a per-site **server key**) and visitor analytics
(through the LevelUp tag, no key). Database side: migrations
`20261024120000_site_api_keys`, `20261024120100_site_payments`,
`20261024120200_site_analytics` (see [database.md](./database.md)).

## Server keys

| | |
|---|---|
| Format | `lu_live_<48 hex>` (real payments) or `lu_test_<48 hex>` (Stripe test mode) |
| Created by | owners and admins of the organization, dashboard → **Developers → Server keys** (MFA when enrolled) |
| Stored | only `sha256(key)`, the prefix and the last 4 characters (`site_api_keys`); the full key is shown **once** |
| Scopes | `payments:write` (payments), `events:write` (reserved for future events) |
| Limits | 10 active keys per website; 300 calls per key per 10 minutes (`PT429`) |
| Revoked | immediately refused (`PT401`); creation and revocation are written to `site_audit_log` |

A server key is a **server secret**: put it in the website's server environment
(`LEVELUP_SITE_KEY`, e.g. Vercel → Settings → Environment Variables), never in
browser code, a `NEXT_PUBLIC_*` variable or the repository.

## Payments: `site_ingest_payment`

Call it from the website's **server** (typically its Stripe webhook, after the
Stripe signature is verified) for every payment state change.

```http
POST {SUPABASE_URL}/rest/v1/rpc/site_ingest_payment
apikey: {SUPABASE_PUBLISHABLE_KEY}
Content-Type: application/json

{ "p_key": "<LEVELUP_SITE_KEY>", "p_event": { …event… } }
```

`SUPABASE_URL` is `https://rncuhmvykrmtxfzqpitc.supabase.co`; the publishable key
is the same public key the websites already use. The key in `p_key` is what
authenticates the call and picks the website: the event cannot name a website.

### Event contract

```json
{
  "provider": "stripe",
  "provider_event_id": "evt_…",
  "provider_session_id": "cs_…",
  "provider_payment_intent": "pi_…",
  "status": "paid",
  "amount": 260,
  "currency": "usd",
  "offer_id": "accompagnement-voyage",
  "offer_name": "Accompagnement voyage",
  "customer_email": "jane@example.com",
  "customer_name": "Jane Doe",
  "occurred_at": "2026-10-20T14:00:00Z",
  "metadata": {}
}
```

| Field | Rule |
|---|---|
| `provider` | `"stripe"` |
| `provider_event_id` | `evt_[A-Za-z0-9_]{1,250}`, required; the same event twice is ignored (`duplicate: true`) |
| `provider_session_id` | `cs_[A-Za-z0-9_]{1,250}`, required; **one payment per session** (upsert key with the website) |
| `provider_payment_intent` | `pi_…` or `null` |
| `status` | `paid` \| `pending` \| `failed` \| `refunded` \| `expired` |
| `amount` | integer, minor units (cents; 260 = 2.60 USD), 0 to 10^11 |
| `currency` | ISO 4217, lowercase (`usd`, `eur`, `cad`) |
| `offer_id` | `[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}` or `null` |
| `offer_name` | text, 200 characters, no HTML, or `null` |
| `customer_email` | valid email or `null` (stored lowercase) |
| `customer_name` | text, 120 characters, no HTML, or `null` |
| `occurred_at` | ISO 8601 **with time zone**, between 2015 and now + 1 day |
| `metadata` | JSON object up to 8 KB (cleaned like form data), or `null` |

Any other field, a wrong type (e.g. `"amount": "260"` or `2.6`) or a value out of
range is refused with `22023` and a message naming the field. A `cs_test_` session
sent with a live key is refused; a test key records payments flagged as test
(hidden by default in the dashboard, "Show test payments").

### Status changes

| From | Accepted next statuses |
|---|---|
| (new) | any |
| `pending` | `paid`, `failed`, `expired` |
| `failed` | `paid`, `expired` |
| `paid` | `refunded` |
| `refunded`, `expired` | none (final) |

A payment never goes back from `paid` to `pending`/`failed`: a late or
out-of-order event answers `200 {"ok":true,"applied":false}` (so webhooks do
not retry) and only fills details that were missing. Every event is kept in
`site_payment_events` (history in the detail drawer).

### Responses

| HTTP | Body / code | Meaning |
|---|---|---|
| 200 | `{"ok":true,"applied":true,"duplicate":false,"status":"paid"}` | recorded |
| 200 | `{"ok":true,"applied":false,"duplicate":true,…}` | same event already received |
| 401 | `PT401` | unknown, malformed or revoked key |
| 403 | `PT403` | key without `payments:write` |
| 400 | `22023` | invalid event (message names the field) |
| 429 | `PT429` | more than 300 calls in 10 minutes for this key |

### Example (Next.js route handler, Stripe webhook)

```ts
// app/api/stripe/webhook/route.ts (server only)
const event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
if (event.type.startsWith('checkout.session.')) {
  const session = event.data.object as Stripe.Checkout.Session;
  const status =
    event.type === 'checkout.session.completed' && session.payment_status === 'paid' ? 'paid'
    : event.type === 'checkout.session.async_payment_succeeded' ? 'paid'
    : event.type === 'checkout.session.async_payment_failed' ? 'failed'
    : event.type === 'checkout.session.expired' ? 'expired'
    : 'pending';
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/site_ingest_payment`, {
    method: 'POST',
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_key: process.env.LEVELUP_SITE_KEY,
      p_event: {
        provider: 'stripe',
        provider_event_id: event.id,
        provider_session_id: session.id,
        provider_payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        status,
        amount: session.amount_total ?? 0,
        currency: session.currency ?? 'usd',
        offer_id: session.metadata?.offer_id ?? null,
        offer_name: session.metadata?.offer_name ?? null,
        customer_email: session.customer_details?.email ?? null,
        customer_name: session.customer_details?.name ?? null,
        occurred_at: new Date(event.created * 1000).toISOString(),
        metadata: {}
      }
    })
  });
}
// charge.refunded: send the same provider_session_id with status "refunded".
```

A failed call should be logged and retried by the webhook (return a 5xx to
Stripe); a `200` with `applied:false` is not an error.

The dashboard's TypeScript copy of the contract (same rules) is
`src/lib/validation/site-events.ts` (`paymentEventSchema`), tested in
`site-events.test.ts`.

### Who sees what

- Members of the organization (viewer and above) see the **Payments** page
  (feature `payments`, or as soon as a payment exists): KPIs per currency,
  revenue chart, top offers, table, detail drawer.
- Customer email / name and `metadata` are only returned to editors and above;
  viewers get `j***@e***.com` / `J. D.` (`site_payments_list`,
  `site_payment_detail`). The table itself never exposes those columns.
- CSV export: owners / admins (`site_payments_export`, MFA, audited, 5000 rows).

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
