# Handoff: LevelUp Ecosystem (read this first)

State of the whole ecosystem as of 2026-11-02, for the next person or agent.
Owner: LevelUp (US based, French speaking). English is the official language
of every product; French is a translation.

**Security comes first.** When a choice trades safety for convenience, choose safety
and explain why in plain words.

## 1. Repositories (GitHub org `levelupbonte-ai`)

| Repo | What | Domain | Stack |
| --- | --- | --- | --- |
| `leveldashs` (this repo) | Client dashboard | dashboard.levelup-ecosystem.com | Next.js 16, bun |
| `app.levelup-ecosystem` | Showcase site, the LevelUp tag (`public/sdk/v1/levelup.js`), public API `/api/v1/*`, `/developers` | levelup-ecosystem.com | Next.js 15 |
| `levelstudio` | AI site builder | (LevelStudio) | Vite, yarn |
| `leveldashbord` | **LevelUp HQ**, the internal admin, started from a copy of this dashboard. Plan: `docs/hq-plan.md` there. Not deployed yet | — | Next.js 16, bun |
| `hq` | **Abandoned** old HQ. Do not use. | — | — |
| `blackpater` | Black Pater client site, Stripe checkout, client portal `/espace-client` | blackpater.com | Vite + React 19 + Vercel functions |
| `Final-Stop-Barbershop-app` | Final Stop client site | finalstop.org | Vite + React, Express server |

All of them share **one Supabase project**: `rncuhmvykrmtxfzqpitc`. Migrations
live only in `leveldashs/supabase/migrations`; tests in `leveldashs/supabase/tests`.

Websites (`public.websites.id`):
- LevelUp: `ws_6e797257f5b32b86`
- LevelStudio: `ws_871c0924a6afc646`
- Final Stop: `ws_d5e600b7dc2ec9a9`
- Black Pater: `ws_ab9493c5857ed460`, organization `ee201882-1e28-438c-a7f7-41ae6ac53d23`

Vercel (team `team_6BzdQw0xheYTY4SuO8yGV7eY`, Hobby plan, so logs are kept 1 hour):

| Project | ID |
| --- | --- |
| showcase | `prj_yLJ8cianUcKegyQRDoZ2dczA86TR` |
| leveldashs | `prj_fNH3V3gYtbZJ4twQQynCM88pFa7K` |
| blackpater | `prj_JFqGcAajmK6hD1jGc8YjPsspP7lf` |
| final-stop | `prj_zdV5CWkm4Mh8YOJbCaY8zUbcas37` |
| levelstudio | `prj_b6FjBw3ow1xeWy0dg6my5nGgjpBh` |

## 2. Non-negotiable rules

- Never put a secret in frontend code or in `NEXT_PUBLIC_*` / `VITE_*`. The
  Supabase **publishable** key is the only key a browser ever sees.
- No app ever uses the Supabase secret / service-role key. Every privileged
  action is a `SECURITY DEFINER` function with `set search_path = ''` that checks
  the caller itself (RLS, role, origin, key hash, rate limit via `private.hit_rate_limit`).
- Secrets go into Vercel as **Sensitive** variables. Never ask the owner to paste a
  secret in chat, and never print one.
- `private.is_platform_admin()` requires an `aal2` (MFA) session.
- Tenant isolation is tested (`supabase/tests/tenant_isolation.sql`, 753 checks, 0 failed).
  Any new table needs RLS and a line in that test.
- The client dashboard never shows internal details: AI providers, keys, costs,
  database or hosting names.
- No fake numbers, testimonials or claims; empty states when there is no data.
- Do not touch the showcase intro animation: `src/components/preloader/*`,
  `preloader.tsx`, the `lu-intro` cover in `layout.tsx`, `video/`.
- If a Supabase MCP confirmation prompt times out, never work around it with
  another tool or reworded SQL. Hand the SQL file to the owner, who runs it in the
  Supabase SQL editor.
- Respect bun's 7-day install cooldown (`bunfig.toml`).
- Don't delete the Firebase project.

## 3. Owner's workflow

- Works on branch `claude/beautiful-turing-3j7y3z` in every repo.
- "fusionne" / "mets en ligne" / "go" means: open the PR and merge it. Otherwise
  push to the branch only.
- After a merge, reset the branch: `git fetch origin main && git checkout -B claude/beautiful-turing-3j7y3z origin/main && git push --force-with-lease -u origin claude/beautiful-turing-3j7y3z`.
- Show screenshots before merging visual changes, unless told to merge.
- Talks casually in French; answer in French, plainly, with no jargon.

## 4. How a website connects to LevelUp

There are two separate pieces. Keep them separate in docs and UI.

### The LevelUp tag (public, in the browser)

```html
<script src="https://levelup-ecosystem.com/sdk/v1/levelup.js" data-site="ws_…" defer></script>
```

Version 1.3.0. Details: `docs/ecosystem-api.md`. What it does:

- **SEO** set from the dashboard: title, description, Open Graph, JSON-LD.
- **Forms** with `data-lu-form` go to the dashboard inbox (`submit_form`).
- **Content** with `data-lu`; booking and waitlist (`LevelUp.bookAppointment`, `joinWaitlist`).
- **Page views**: `/api/v1/pageview` → `track_pageview`. No cookies, no stored IPs,
  Do Not Track respected, can be turned off with `data-analytics="off"`.
- **Install ping**: `tag_ping` sets `websites.tag_last_seen_at`, which drives
  "LevelUp tag: Active / Not detected" on the Developers page. The database
  stores at most one ping every 10 minutes.

Writes are accepted **only from the site's `allowed_origins`**: exact origins,
`www` and apex listed separately.

### Server keys (secret, on the site's server)

`lu_live_…` / `lu_test_…` keys are stored hashed, shown once, scoped and revocable.
Details: `docs/site-api.md`.

- Scope **payments**: `site_ingest_payment` takes payments from 25 providers
  (Stripe, PayPal, Square, mobile money, …), amounts in ISO 4217 minor units.
  Payments never go through the browser.
- Scope **client portal**: the `portal_*` functions (Black Pater's `/espace-client`).

### Our own sites

Black Pater and Final Stop do not use the tag file. They call the same database
functions from their own code:

- Black Pater: `public/js/levelup.js` and `api/_lib/*`.
- Final Stop: `src/lib/site/api.ts`.

## 5. Billing, campaigns, portal (all live)

- **Billing** (`docs/billing.md`):
  - plans Free / Starter / Pro / Business with limits;
  - invoices numbered `LU-<year>-<0001>`, discounts and promo codes;
  - online payments are off by default (`LEVELUP_ONLINE_PAYMENTS`); Stripe and Square
    providers exist. LevelUp's own Stripe account is blocked ("high risk").
- **Email campaigns** (`docs/email-campaigns.md`):
  - opted-in contacts only, CAN-SPAM footer;
  - sent from `campaigns@levelup-ecosystem.com`.
- **Black Pater client portal**:
  - sign-in with a 6-digit e-mail code (hashed, 10 minutes, single use, 5 tries) or
    an optional password (bcrypt, breached-password check), 7-day HttpOnly sessions;
  - e-mails are sent by **Black Pater's server with Black Pater's own Resend key**;
  - the dashboard only queues the e-mails, then pokes the site
    (`/api/portal/outbox`, HMAC-signed with `PORTAL_NOTIFY_SECRET`, same value on
    both projects). A daily Vercel cron retries.

## 5b. Security watch, logs, AI (2026-11-03)

- **Security watch** (`20261103200000_security_watch`): `private.security_scan()` runs
  every 15 minutes (pg_cron `security-scan`). Signals: floods on a rate-limited
  action, guessing (codes, verifications, activations), outsiders trying HQ,
  HQ team / key / settings changes, new platform admins, sign-up floods. Alerts go
  to `private.security_alerts` (HQ > Security) and, when the owner has added the
  Resend key to Supabase Vault as `resend_alerts_key`, by e-mail to active HQ
  owners. Never put that key in code or chat.
- **Activity logs** (`20261103210000_activity_and_ai`): content changes made by
  people (settings, content, services, FAQ, gallery, team, reviews, announcements,
  media) go to `site_audit_log` (same item, same person: once per 2 minutes).
  Client dashboard: Activity log page (owners / admins, `site_activity_log`;
  LevelUp staff show as "LevelUp"). HQ: Client activity (`hq_list_site_activity`).
- **AI**: the client assistant is at `/dashboard/site/assistant`. It reads up to
  3 attached files (images resized in the browser, PDFs, text; real type checked,
  read once by the `vision` route, never stored), classifies problems
  (`classify_problem`) and prepares actions shown as cards with Authorize /
  Decline: service, FAQ, SEO, request / appointment status, announcement draft,
  and a ticket to LevelUp support (`support_tickets`, `support_ticket_create`;
  HQ > Support). Nothing changes until the user authorizes it. HQ > AI usage
  (`hq_ai_overview`): calls per app, model and client, key health, never keys.
- **Daily database backup** (`.github/workflows/db-backup.yml`) fails with
  "password authentication failed": the GitHub secret `SUPABASE_DB_URL` must be the
  Session pooler URI with the current database password.

## 5c. LevelUp Forms (lot 1, 2026-11-04)

- Clients build forms in the dashboard (`/dashboard/site/forms`: starters, fields,
  look, after sending, share) and LevelUp hosts them at
  `dashboard.levelup-ecosystem.com/f/<public_id>` (no sign-in, `noindex`).
- Database (`20261104100000_site_forms`): `site_forms` (fields and settings
  validated by `private.form_clean_fields` / `form_clean_settings`),
  `site_form_save` / `site_form_archive` (editor+), `site_forms_list`,
  `public_form_get` and `public_form_submit` (anon). The submit checks every
  value against the stored fields (unknown fields, wrong types, choices, HTML,
  sizes) and writes `form_submissions` (with `site_form_id`), so answers show in
  Requests.
- `POST /api/forms/[id]`: same origin, honeypot, time check, per-sender limit
  (hashed IP), and Cloudflare Turnstile when `TURNSTILE_SECRET_KEY` is set on
  Vercel (Sensitive).
- Next lots: embed in the client's site through the LevelUp tag
  (`data-lu-embed`), confirmation e-mails, file uploads, multi-step, custom
  domain.

## 6. Open items

### Owner actions still pending

- leveldashs:
  - `LEVELUP_EMAIL_KEY`, `CRON_SECRET` (also as a GitHub secret);
  - `RESEND_WEBHOOK_SECRET`, for campaigns.
- Google Search Console for levelup-ecosystem.com, blackpater.com and finalstop.org.
- Billing:
  - set the Starter / Pro / Business prices and the issuer details;
  - assign plans to clients.
- Re-run `supabase/tests/tenant_isolation.sql` and confirm 0 failed.
- The tag on other sites: the owner said they pasted it on some sites but sees no
  data. No new website is registered, so that is the likely cause. Ask which
  domains, register each one with its exact origins, and give it its own `ws_` line.

### On branches, not merged yet (2026-11-02)

- **`blackpater`**:
  - `tag_ping` from `public/js/levelup.js`, so the dashboard shows Black Pater as
    connected;
  - a `RouteErrorBoundary` around the routed page.
- **`Final-Stop-Barbershop-app`**: `tag_ping` from `src/lib/site/api.ts`.

### Known bug: Black Pater blank page

Sometimes a click leaves a blank page, with `TypeError: l is not a function` in
React's passive-effect cleanup (`commitHookEffectListUnmount`). In other words, an
effect's cleanup is not a function.

- Every `useEffect` in `blackpater/src` was audited and looks correct.
- It did not reproduce in automated click tests (English / French, light / dark,
  mobile).
- The boundary above keeps the site usable and logs the component stack. Ask the
  owner for that console line to find the component.

## 7. Next steps the owner asked for

1. **HQ takes over all admin work** in `levelupbonte-ai/leveldashbord` (lot 1 done: admin + aal2 gate; next lots in its `docs/hq-plan.md`).
   Move these into HQ, behind `requireHqSession()` and `hq_*` functions that write
   the audit log:
   - platform admin;
   - Studio templates;
   - plan prices and client plans;
   - invoices;
   - client portals;
   - keys.

   **Then** remove them from this dashboard, including the `isPlatformAdmin`
   bypasses in the sidebar and billing. An admin account then sees the dashboard as
   a normal member. Never remove a feature before its HQ version works.
2. **Make connecting a developer's site painless.** Checklist:
   - **Origins**: one-click "add www / apex"; show the exact origin the last
     refused call came from. Store refusals without IPs, counted and rate-limited.
   - **Developers page diagnostics**:
     - last ping;
     - last refused origin;
     - CSP hint (`script-src levelup-ecosystem.com`,
       `connect-src` for the API);
     - a "test my install" button.
   - **SPA support**: page views on `pushState` (done in 1.3.0); content and SEO
     applied again after client-side navigation.
   - **Staging / preview domains**: separate `lu_test_` keys and test origins.
   - **Duplicate tags** on one page: no-op (guard global).
   - **Versioning**: keep `/sdk/v1/` frozen and backward compatible; breaking
     changes go to `/sdk/v2/`.
3. **Server key improvements**, in this order:
   1. outgoing **webhooks** (new form, booking, payment), HMAC-signed and retried;
   2. a **per-key log**: last used, call count, errors;
   3. **read scopes**, so a site's back end can read its own contacts, bookings
      and payments;
   4. key **expiry** and rotation without downtime, optional IP allowlist.
