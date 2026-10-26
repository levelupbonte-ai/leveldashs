# Database (Supabase)

One Supabase project (`levelup-ecosystem`) is the single source of truth for the
whole LevelUp Ecosystem: the marketing site (`app.levelup-ecosystem`), LevelStudio
and this client dashboard. Firebase is being retired.

## Migrations

Versioned SQL lives in [`supabase/migrations`](../supabase/migrations). Never change
the schema from application code or by hand in the dashboard.

| Version | Name | Status |
|---|---|---|
| `20261004000000` | baseline | Already in production before versioning. Mark it applied: `supabase migration repair --status applied 20261004000000` |
| `20261007132109` | security_hardening | **Applied** |
| `20261007140000` | tenant_foundation | **Applied** |
| `20261007150000` | website_content | **Applied** |
| `20261007160000` | platform_seed | **Applied** |
| `20261007160500` | final_stop_content | **Applied** |
| `20261007170000` | confirmation_emails | **Applied** |
| `20261007180000` | studio_usage_rpc | **Applied** |
| `20261007190000` | media_video_and_blackpater | **Applied** |
| `20261007200000` | platform_admin_management | **Applied** |
| `20261007201000` | add_member_by_email | **Applied** |
| `20261007210000` | ecosystem_api (site bundle, allowed origins, onboarding, invitations) | **Applied** |
| `20261007220000` | levelup_tag (install verification) | **Applied** |
| `20261007230000` | levelup_site_content (LevelUp site pricing, FAQ, portfolio, settings) | **Applied** |
| `20261007231000` | ai_key_state (shared AI key rotation, fingerprints only) | **Applied** |
| `20261008110000` | project_requests (showcase "Start a project" + AI qualification) | **Applied** |
| `20261008120000` | ai_catalog (`ai_models`, `ai_routes`, views `ai_usage_stats`, `ai_model_ranking`; staff read `ai_calls`) | **Applied** |
| `20261011100000` | rate_limits (`private.rate_limit_events`, `private.hit_rate_limit`; access requests 10/hour per account) | **Applied** |
| `20261011110000` | legal_acceptances (table + RLS, `accept_legal_terms` RPC, sign-up trigger; see auth.md) | **Applied** |
| `20261011130000` | contracts (templates, contracts, signatures, required tasks, gate helpers, restrictive content policies, private `contracts` bucket, staff + `sign_contract` RPCs; see [contracts.md](./contracts.md)) | **Applied** (through the MCP in parts: `contracts_tables`, `contracts_access_gate`, `contracts_order_form`, `contracts_staff_create_send`, `contracts_staff_manage`, `contracts_publish_template`, `contracts_sign`) |
| `20261011130100` | contract_templates_seed (Master Services Agreement v1 EN + FR) | **Applied** (`contract_templates_seed_en`, `contract_templates_seed_fr`, `contract_templates_publish_v1`; bodies verified byte-for-byte by SHA-256) |
| `20261012130000` | msa_v2 (Master Services Agreement v2 EN + FR: v1 without the §12.1 non-solicitation clause, §12 renumbered) | **Applied** (`msa_v2`, derived from v1 in SQL; bodies checked by MD5 against this file) |
| `20261024100000` | access_review (`private.url_host`, `email_domain`, `website_hosts`; `access_requests.website_id`; `admin_list_access_requests`, `admin_access_review_context`) | **Applied** (`access_review_helpers`, `access_review_url_host_backslash`) |
| `20261024100100` | admin_review_access_request (explicit connect / create / reject, fix + archive empty org, audit; old `review_access_request` delegates and never creates an organization) | **Applied** (`admin_review_access_request`) |
| `20261024100200` | team_invitation_emails (invitation columns, `private.organization_invitation_tokens`, create / resend / record / revoke / preview / accept RPCs, `accept_invitations` skips revoked) | **Applied** (`team_invitation_tokens`, `team_invitation_send`, `team_invitation_accept`) |
| `20261024100300` | site_owner_claims (`private.website_owner_claims`, `private.website_activation_codes`, owner e-mail auto-link trigger + `claim_site_ownership`, staff code functions, `redeem_activation_code`) | **Applied** (`site_owner_claims_tables`, `site_owner_claims_autolink`, `site_owner_claims_staff`, `site_activation_redeem`) |
| `20261024120000` | site_api_keys (per-site server keys, sha256 only, admin create/revoke; `site_audit_log`; see [site-api.md](./site-api.md)) | **Applied** (`site_audit_log`, `site_api_keys`) |
| `20261024120100` | site_payments (`site_payments`, `site_payment_events`, `site_ingest_payment`, masked list / detail, admin export, summary) | **Applied** (`site_payments_tables`, `site_ingest_payment`, `site_payments_reads`) |
| `20261024120200` | site_analytics (`track_pageview`, daily counters, salted bloom filter for unique visitors, `site_analytics_summary`) | **Applied** (`site_analytics_tables`, `site_analytics_track_summary`) |
| `20261024120250` | levelup_own_sources (features `project_requests`, `studio_insights`; project requests + LevelStudio aggregates for the owning organization) | **Applied** (`levelup_own_sources`) |
| `20261024120300` | site_insights (`site_capabilities`, `site_overview_stats`, `site_recent_activity`, `site_submissions_list`; custom form types; `archived` inbox status) | **Applied** (`custom_form_types`, `site_insights_reads`) |

Versions applied through the Supabase MCP were recorded with their apply
timestamp; align the history once with `supabase migration list` /
`supabase migration repair` before using `supabase db push`.

After applying, run the suites in [`supabase/tests`](../supabase/tests) in the SQL
editor. They always roll back; the error message is the report and must show
`0 failed`.

## Tenant model (tenant_foundation)

```
auth.users ─1:1─ profiles
     │
     └─< organization_members >─ organizations ─< websites (ws_xxxxxxxxxxxxxxxx)
            role: owner|admin|editor|viewer          │
                                                     ├─< website_features >─ features (catalog)
                                                     └─< media  → Storage bucket "media"
                                                                  <organization_id>/<website_id>/<file>
```

- Every tenant-owned row carries `organization_id` (and `website_id` when it belongs
  to a website). Child rows reference `websites (id, organization_id)` with a
  composite FK, so a row can never point at another tenant's website.
- New content tables (announcements, gallery, services, …) must follow the same
  pattern: `organization_id` + `website_id` + composite FK + RLS through
  `private.has_org_role(organization_id, '<min role>')`.

## Websites

| Website | `WEBSITE_ID` | Organization |
|---|---|---|
| levelup-ecosystem.com | `ws_6e797257f5b32b86` | LevelUp Ecosystem |
| studio.levelup-ecosystem.com | `ws_871c0924a6afc646` | LevelUp Ecosystem |
| finalstop.org | `ws_d5e600b7dc2ec9a9` | Final Stop Barber Shop & Salon |
| blackpater.com | `ws_ab9493c5857ed460` | Black Pater |

Attach an owner once their Supabase account exists (SQL editor):

```sql
insert into organization_members (organization_id, user_id, role)
select 'd2d91733-77fe-4840-8a47-4564de49dd29', id, 'owner' from auth.users where email = 'owner@example.com';
-- LevelUp staff:
insert into platform_admins (user_id) select id from auth.users where email = 'you@example.com';
```

## Website content (website_content)

| Table | Holds | Public (anon) | Members |
|---|---|---|---|
| `website_settings` | key/value: contact, hours, social, booking slots, waitlist toggle, branding | read `is_public` rows of live sites | viewer read, editor write |
| `content_blocks` | page sections (hero, about…) as JSON | read published | viewer read, editor write |
| `team_members`, `services`, `gallery_items`, `reviews`, `faq_items`, `announcements` | site content | read published | viewer read, editor write |
| `appointments`, `waitlist_entries`, `form_submissions` (any form type `^[a-z][a-z0-9_]{1,39}$`) | customer interactions | **no direct access** — RPCs only | viewer read, editor updates status/notes, admin deletes |
| `studio_templates`, `studio_projects`, `studio_usage` | LevelStudio | published starter/style templates | owner reads own; writes via LevelStudio server |

Public RPCs (callable with the publishable key): `get_public_website`,
`submit_form`, `book_appointment`, `join_waitlist`, `get_public_waitlist`,
`get_ticket_status`. They check that the website is live and the feature is
enabled, take prices/names from the database (never from the browser),
rate-limit (5/hour per contact, 300/hour per site) and return ticket codes
instead of row ids. Errors use PostgREST status codes (`PT403`, `PT404`,
`PT409`, `PT429`).

## Payments, analytics and the adaptive dashboard

| Table | Holds | Members | Writes |
|---|---|---|---|
| `site_api_keys` | server keys of a website (hash, prefix, last 4, scopes, last use, revoked) | owners / admins read (no hash column) | `site_create_api_key`, `site_revoke_api_key` (audited) |
| `site_audit_log` | key creation / revocation, payment exports, project request updates | owners / admins read | SECURITY DEFINER functions only (append-only) |
| `site_payments`, `site_payment_events` | payments reported by the website server, every event received | viewer read without customer columns; customer details via `site_payments_list` (masked for viewers) | `site_ingest_payment` (server key) |
| `site_traffic_daily`, `site_pageviews_daily` | daily views / unique visitors per path, referrer host, language | viewer read | `track_pageview` (LevelUp tag) |

Contracts and rules: [site-api.md](./site-api.md). Tests:
`supabase/tests/site_payments.sql`, `site_analytics.sql`, `site_insights.sql`,
`levelup_sources.sql`.

Applied through the MCP (names above). After any change, run the four suites
(they always roll back and must report `0 failed`). Advisors after applying:
*RLS enabled, no policy* on `private.analytics_salt`, `private.site_visitor_bloom`,
`private.pageview_buckets` (closed to every API role, intentional); *SECURITY
DEFINER executable* for `track_pageview`, `site_ingest_payment` (anon: they
authenticate by origin / server key) and the `site_payments_*`,
`site_project_requests_*`, `site_owned_*`, `site_studio_summary` readers
(authenticated: each checks membership, role and MFA itself).

## Showcase CMS (showcase_cms)

`showcase_templates`, `showcase_projects` and `showcase_sections` drive the
LevelUp showcase site (feature `showcase_cms`): same tenant model and RLS as
the content tables, exposed under `showcase` in `get_site_bundle`, revalidate
trigger on every write. See [showcase-cms.md](./showcase-cms.md).

## AI catalog and usage (ai_catalog)

| Object | Content | Access |
|---|---|---|
| `ai_models` | every `provider:model` the apps can call: label, `tier` (`free`/`paid`), cost note, strengths, `apps[]`/`tasks[]` | platform admins read |
| `ai_routes` | `app` + `task` → models in fallback order (`position`), French description of where it is used | platform admins read |
| `ai_calls` | one row per answered AI call (app, task, provider, model; never content), written by the apps' servers / `log_ai_call` | platform admins read |
| `ai_usage_stats` (view) | calls per app/task/provider/model: 24 h, 7 d, 30 d, total, last use | `security_invoker`: admins only |
| `ai_model_ranking` (view) | per model: 30-day calls, share %, rank, label/tier | `security_invoker`: admins only |

The catalog is seeded from the default routes in code (dashboard `src/lib/ai/router.ts`,
LevelStudio `server/lib/ai-router.ts`, showcase `src/lib/ai/router.ts`). When a route
changes in code, update the seed (insert … on conflict) in a new migration. Shown on
`/dashboard/exclusive` → *Intelligence artificielle*; project requests (`project_requests`)
show in *Demandes de projet* on the same page.

## Authorization

| Who | Can |
|---|---|
| `viewer` | Read the organization, its websites, features, media |
| `editor` | + upload / edit / delete media |
| `admin` | + rename org / websites, edit website `settings`, manage non-owner members |
| `owner` | + grant or remove `owner` (an org always keeps ≥ 1 owner) |
| Platform admin (`platform_admins`) | Same as `admin` in **every** organization (never `owner`) |
| LevelUp (service role / API) | Create websites, change status/domain, enable features |

- RLS helpers live in the `private` schema (not exposed by the Data API).
- Column-level grants stop clients from changing ownership, website status,
  domains or feature flags even where a row is updatable.
- `public.create_organization(name, slug)` — creates an org and makes the caller
  owner (max 5 owned orgs per user).
- `public.add_organization_member(organization_id, email, role)` — adds an
  **existing** account to an organization by e-mail, or changes its role (admin+;
  owner to grant `owner` or change an owner). Returns `added`, `updated` or
  `not_found` (no account with that e-mail). Callable by `authenticated` only.
- `public.admin_review_access_request(user_id, mode, website_id, role, confirm_website_id,
  organization_name, website_name, website_domain)` — staff decision on an access request
  (`connect` / `create` / `reject`). Raises short codes (`email_unconfirmed`,
  `invalid_website_id`, `website_not_found`, `website_archived`, `already_member`,
  `already_approved`, `confirmation_required`, `domain_taken`, …) mapped to `AppError` codes
  by `src/lib/access/db-errors.ts`. Returns the organization / website it used.
- Team invitations: `create_organization_invitation`, `resend_organization_invitation`,
  `record_organization_invitation_email`, `revoke_organization_invitation`,
  `get_organization_invitation(token)` (anon: preview), `accept_organization_invitation(token)`.
  Tokens are stored as SHA-256 only (`private.sha256_hex`).
- Client self-serve access: `admin_set_site_owner_email`, `admin_create_activation_code`
  (returns the code once), `admin_revoke_activation_code`, `admin_get_site_access`,
  `claim_site_ownership()`, `redeem_activation_code(code, client_hash)`.
- Audit: these functions write `public.hq_audit_log` through `private.hq_log` (the
  append-only log of LevelUp HQ, same database): `access_request.*`, `organization.*`,
  `team.invitation_*`, `site.owner_*`, `site.activation_code_*`. Codes and tokens are never
  logged.
- `public.get_public_website(website_id)` — public config of an **active** website
  (name, domain, enabled features). Callable by `anon`.
- Platform staff are listed in `platform_admins` (insert with the service role only).
  Since `platform_admin_management`, `private.has_org_role()` grants them any role
  up to `admin` in every non-archived organization, so content, inbox, media and
  Storage policies apply to them without extra policies. Owner-only actions stay
  with the client's real owners.

Note: deleting an auth user who is the last owner of an organization is blocked
until ownership is transferred.

## Storage uploads

| Bucket | Used for | `file_size_limit` | `allowed_mime_types` | Paths (storage RLS) |
|---|---|---|---|---|
| `brand` (public) | avatars, organization logos | 2 MB | `image/png`, `image/jpeg`, `image/webp` | `avatars/<user id>/`, `orgs/<org id>/` |
| `contracts` (private) | signed contract PDFs | 5 MB | `application/pdf` | `<organization id>/<contract id>.pdf` (members read, owners/admins insert once signed, no update/delete) |
| `media` (public) | website media library | 10 MB | jpeg, png, webp, gif, avif, pdf, mp4, webm | `<organization id>/<website id>/` (editor+) |

The bucket limits are enforced by Supabase Storage for every client. The dashboard checks
the same rules before uploading (`src/lib/brand-images.ts`, `uploadMedia` in
`src/features/site/api/service.ts`) and also reads the first bytes of the file
(`src/lib/file-signature.ts`): the content must be one of the allowed formats **and**
the declared one, so a renamed HTML or SVG file is refused. **SVG is never accepted**
(it can carry scripts; there is no sanitizer). Brand images are re-encoded to a 512 px
WebP in the browser (any picked PNG/JPEG/WebP up to 8 MB, stored file ≤ 2 MB). There is
no upload route handler: files go straight to Storage as the signed-in user.

## Backups

The Free plan has no downloadable automatic backups, so
[`.github/workflows/db-backup.yml`](../.github/workflows/db-backup.yml) runs every day
(06:17 UTC) and on demand: `supabase db dump` (roles, schema, data) with a pinned
Supabase CLI, `tar.gz`, encrypted with `gpg --symmetric` (AES-256), uploaded as a
workflow artifact kept **30 days**, plus an optional copy in a private R2/S3 bucket.
It needs the repository secrets `SUPABASE_DB_URL` (session pooler connection string)
and `BACKUP_PASSPHRASE`; secrets are never printed. Restore guide and setup:
[`scripts/restore-backup.md`](../scripts/restore-backup.md). Storage files are not
included.

## Security advisors (reviewed 2026-10-11)

`get_advisors(security)` after the `rate_limits` and `legal_acceptances` migrations:

- *RLS enabled, no policy* on `private.rate_limit_events`, `ai_key_state`, `ai_usage`,
  `studio_usage`, `studio_rate_limits` — intentional: server-only tables, closed to every
  API role (`studio_*` belong to LevelStudio).
- *SECURITY DEFINER executable by anon/authenticated* — the public RPCs (`submit_form`,
  `book_appointment`, …) and the authenticated ones (`accept_legal_terms`,
  `submit_access_request`, admin RPCs) are the intended API; each checks the caller
  and validates its input.
- *Leaked password protection disabled* — Supabase Pro feature (HaveIBeenPwned check in
  Auth). The dashboard already refuses common passwords client-side (Pwned Passwords
  k-anonymity, see auth.md); enable it in Auth → Password security on Pro.

## Secrets

- Browser: only the project URL and the **publishable/anon** key.
- This dashboard uses only the publishable key, on the server too: every query runs
  as the signed-in user (Supabase Auth, see [auth.md](./auth.md)) through RLS.
- `SUPABASE_SECRET_KEY` / service role is for trusted server-side tooling only
  (e.g. `scripts/migrate-media.mjs`). Never prefix it with `NEXT_PUBLIC_` and never
  add it to the dashboard's environment.

## Media migration

`scripts/migrate-media.mjs` moves a website's images into the `media` Storage
bucket, registers them in `media` and rewrites every reference:

```bash
# Final Stop: download the images currently hot-linked (i.ibb.co, Unsplash)
SUPABASE_URL=https://rncuhmvykrmtxfzqpitc.supabase.co SUPABASE_SECRET_KEY=... \
  node scripts/migrate-media.mjs --website ws_d5e600b7dc2ec9a9

# Black Pater: upload the self-hosted files and update content block site/media
SUPABASE_URL=https://rncuhmvykrmtxfzqpitc.supabase.co SUPABASE_SECRET_KEY=... \
  node scripts/migrate-media.mjs --website ws_ab9493c5857ed460 --dir ../blackpater/public/media
```

Add `--dry-run` first to see what would change. Run it from a machine that can
reach Supabase; the secret key stays on that machine.
