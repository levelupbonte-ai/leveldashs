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
| `20261025100000` | chat_schema (`chat_conversations`, `chat_participants`, `chat_messages`, `chat_visitors`, RLS reads via `private.chat_can_read`, Realtime publication, Vault key + pgcrypto body encryption, feature `site_chat`; see [chat.md](./chat.md)) | **Applied** (`chat_tables`, `chat_access_rls`, `chat_encryption`, `chat_key_integer`; the live database also keeps an unused `private.chat_key(smallint)` from the first apply, safe to drop) |
| `20261025100100` | chat_member_rpcs (`chat_list_conversations`, `chat_list_messages`, `chat_get_message`, `chat_list_members`, `chat_unread_total`, `chat_send_message`, `chat_edit_message`, `chat_delete_message`, `chat_mark_read`, `chat_set_muted`, `chat_open_direct`) | **Applied** (`chat_rpc_helpers`, `chat_rpc_reads`, `chat_rpc_writes`) |
| `20261025100200` | chat_visitors (contact form trigger, public `send_site_message`, `chat_set_visitor_status`, `chat_visitor_contact`) | **Applied** (`chat_visitor_ingest`, `chat_visitor_rpcs`) |
| `20261026100000` | platform_admin_aal2 (`private.is_platform_admin()` requires an aal2 session, so a staff password alone gives no cross-tenant access; `assert_platform_admin` keeps the aal2 message; drops unused grants on `ai_usage` and `organization_invitations`) | **Not applied yet** (MCP confirmation unanswered during the 2026-10-26 audit) |
| `20261026110000` | billing_schema (`plans`, `organization_billing`, `discounts`, `discount_redemptions`, `billing_charges`, `plan_upgrade_requests`; staff-only read RLS, no client grants beyond SELECT; seed Free / Starter / Pro / Business, LevelUp's own organization on Business) | **Applied** (`billing_schema`) |
| `20261026110100` | billing_functions (`private.plan_limit`, `assert_within_limit`, `effective_price`, `best_discount`; `billing_summary`, `redeem_discount_code`, `request_plan_upgrade`; staff `admin_*` billing functions, audited) | **Applied** (`billing_helpers`, `billing_client_functions`, `billing_staff_functions`; the later fixes to `admin_create_charge`, `admin_update_charge`, `admin_save_discount`, `admin_set_discount_active`, `admin_save_plan`, `admin_list_billing_orgs` were applied with `execute_sql`) |
| `20261026110200` | billing_limits (seat limit in `create_organization_invitation` / `add_organization_member`, monthly plan allowance in `assistant_consume`) | **Applied with `execute_sql`** (the `apply_migration` call waited for a confirmation that never came; not in the migration history: `supabase migration repair --status applied 20261026110200`) |
| `20261026110300` | billing_usage (`private.org_storage`, `public.billing_usage`: storage, media files, chat messages, assistant requests, team, websites this month) | **Applied with `execute_sql`** (same: repair `20261026110300`) |
| `20261026120000` | media_storage (object layout `org/<org>/site/<site>/<yyyy>/<mm>/<uuid>.<ext>`, immutable objects, trusted `media` index with thumbnails, `media_list`, `media_library_stats`, `org_storage_usage`; see *Media storage* below) | **Pending**: written and dry-run tested (suite `media_storage.sql`, 47/47, rolled back). Apply with `apply_migration` (`media_storage`); it drops and replaces the legacy `media_check` constraint |
| `20261026130000` | billing_invoices (`billing_issuers` (empty, staff-edited), `private.invoice_counters`, invoice number / issue date / payment method / reference / provider columns on `billing_charges`, numbering triggers, `admin_record_charge_payment`, `billing_charge_document`, `admin_get_billing_issuer`, `admin_save_billing_issuer`; `billing_summary` adds `documents_ready`; see [billing.md](./billing.md)) | **Pending**: the `apply_migration` call of 2026-10-26 waited for a confirmation that never came. Apply it in the SQL editor (or `apply_migration`, name `billing_invoices`). Dry-run on a local replica: suite `invoices.sql` 77/77 |
| `20261026130100` | media_storage_limit (`private.org_storage` reads `org_storage_usage`; `media_check_upload`, `private.assert_media_quota`, `private.media_quota_open` in the `media_objects_insert` policy, `media_before_insert` checks `media_mb`) | **Pending** (same). Apply after `billing_invoices`, name `media_storage_limit` |
| `20261026130200` | billing_online_payments (`private.billing_webhook_keys`, `private.billing_checkouts`, `billing_payment_events`, `admin_create_billing_webhook_key` / `admin_revoke_…` / `admin_billing_webhook_key_status`, `billing_checkout_prepare`, `billing_checkout_record`, `billing_ingest_stripe_event` (anon, billing webhook key)) | **Pending** (same). Apply last, name `billing_online_payments` |
| `20261031100000` | site_payments_providers (provider-neutral payments: provider allow-list `private.site_payment_providers()`, `method` column, `cancelled` status, unique keys per website + provider + payment / event id, aliases for the former Stripe field names, provider / method filters on `site_payments_list` / `site_payments_export`, providers / methods in `site_payments_summary`; see [site-api.md](./site-api.md)) | **Applied** (`site_payments_providers`); suites `site_payments.sql` 53/53, `payments_providers.sql` 52/52 |
| `20261031110000` | seo_text_limits (`website_settings_seo_len_check`: SEO title 70, description 320, business name 120, verification code 100, image 2048, 20 keywords; NOT VALID then validated, every existing row fits; the form stops at 60 / 160; see [forms.md](./forms.md)) | **Applied** (`seo_text_limits`); suite `text_limits.sql` 6/6 |
| `20261031120000` | billing_square (Square payment links: `private.billing_square_orders`, `billing_checkout_record_square`, `billing_ingest_stripe_event` accepts `provider: square`; provider / event type / outcome constraints widened; see [billing.md](./billing.md#square-payment-links)) | **Applied** (`billing_square`; suite `billing_square.sql` 28/28) |
| `20261031120100` | studio_admin (LevelStudio in the staff area: `admin_studio_templates`, `admin_studio_template_preview`, `admin_studio_set_template_published`, `admin_studio_projects`, `admin_studio_project_preview`, `admin_studio_creator_email`; platform admin + aal2, audited `studio.*`; `private.studio_template_publication` + trigger so LevelStudio's template sync keeps a staff unpublish) | **Applied** (`studio_admin`; suite `studio_admin.sql` 22/22) |
| `20261031130000` | email_campaigns (`email_contacts`, `email_contact_imports`, `email_campaigns`, `email_campaign_recipients`, `email_test_sends`, `email_events`, `email_sender_profiles`; private site state, worker keys, webhook status; newsletter trigger + backfill; member, worker, webhook, unsubscribe and staff `email_*` functions; plan limit `emails_month`; see [email-campaigns.md](./email-campaigns.md)) | **Applied** (`email_campaigns`, 2026-11-01; suite `email_campaigns.sql` 83/83 on the live project, rolled back) |
| `20261101120000` | client_portal (feature `client_portal`, enabled for Black Pater; `portal_customers` (created by a trigger on paid `site_payments`, or invited), `portal_items`, `portal_item_states`, `portal_messages`; private `portal_codes`, `portal_passwords`, `portal_sessions`, `portal_outbox`, `portal_download_tickets`; server-key scope `portal:access`; customer functions `portal_*` called by the website's server, owner functions `portal_admin_*` (editor+, audited in `site_audit_log`); private bucket `portal-documents`; see *Client portal* below) | **Applied** (`client_portal`); suite `client_portal.sql` 93/93 |
| `20261101130000` | client_portal_offers (`portal_admin_overview` lists the offers of `website_features.config.offers` before payments exist; Black Pater's Solo / Duo / Famille) | **Applied** (`client_portal_offers`) |
| `20261111100000` | portal_subscriptions (membership model: `portal_settings` (free offer days/level, members-only contact), `portal_plans` (3 monthly plans per site), `portal_subscriptions` (Stripe state reported by the site's server); `portal_customers.trial_ends_at` / `deleted_at`; `portal_items.min_level`; member functions `portal_subscribe_start`, `portal_subscription_refs`, `portal_subscription_sync`, `portal_messages_since`, `portal_delete_account_begin` / `_finish`; owner functions `portal_admin_settings`, `portal_admin_save_settings`, `portal_admin_save_plan` (admin+), `portal_admin_set_trial`; bcrypt cost 10; rate-limit rows pruned after 3 days) | **Applied** (`portal_subscriptions`) |
| `20261112090000` | portal_plan_change (`portal_subscription_sync` applies the plan of a known subscription when the member switches plans) | **Applied** (`portal_plan_change`) |
| `20261112120000` | portal_membership (monthly membership, no automatic charge: `portal_periods` (one row per paid month, membership or plan, linked to its `site_payments` row; refunds shorten it), `portal_customers.member_until` / `reminders_off`, `portal_settings.membership_monthly` / `period_days`; `portal_customer_from_payment` adds the month (member named by `metadata.portal_customer_id`, else the payer's e-mail); information and sending messages need a running membership (`PT402`); member functions `portal_renew_start`, `portal_set_reminders`; daily `portal-renewal-reminders` cron queues outbox `renew` (7/3/1/0 days); owner `portal_admin_set_member_until`; Black Pater founders until 2026-12-12) | **Applied** (`portal_membership`, `portal_membership_refund_fix`) |

Versions applied through the Supabase MCP were recorded with their apply
timestamp; align the history once with `supabase migration list` /
`supabase migration repair` before using `supabase db push`.

After applying, run the suites in [`supabase/tests`](../supabase/tests) in the SQL
editor. They always roll back; the error message is the report and must show
`0 failed`.
`tenant_isolation.sql` is the cross-tenant suite (two organizations, two LevelStudio
users, platform admins on aal1 / aal2): every table with `organization_id`, Storage,
every member-facing RPC with another tenant's ids, anon, viewer masking. Run it after
every migration that adds a table or a function. `tenant_foundation.sql` keeps the
phase 1 role checks.

## Tenant model (tenant_foundation)

```
auth.users ─1:1─ profiles
     │
     └─< organization_members >─ organizations ─< websites (ws_xxxxxxxxxxxxxxxx)
            role: owner|admin|editor|viewer          │
                                                     ├─< website_features >─ features (catalog)
                                                     └─< media  → Storage bucket "media"
                                                                  org/<organization_id>/site/<website_id>/<yyyy>/<mm>/<uuid>.<ext>
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

LevelUp staff see LevelStudio's catalog and the sites people generate on *LevelUp admin →
LevelStudio* (`/dashboard/exclusive/studio`) through the `admin_studio_*` functions only
(platform admin on aal2; no table access is granted to staff). Lists return no HTML and
mask creator e-mails (`private.hq_mask_email`); the full e-mail is a separate, audited call.
Every list and preview writes `studio.viewed` to `hq_audit_log` (search text is not logged).
Previews render the stored HTML in an iframe sandboxed with `allow-scripts` only (never
`allow-same-origin`) plus a CSP that blocks network calls (`src/features/studio-admin/lib/preview.ts`).
Nothing is edited from there except a template's published flag.

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
| `site_payments`, `site_payment_events` | payments reported by the website server (any allow-listed provider), every event received | viewer read without customer columns; customer details via `site_payments_list` (masked for viewers) | `site_ingest_payment` (server key) |
| `site_traffic_daily`, `site_pageviews_daily` | daily views / unique visitors per path, referrer host, language | viewer read | `track_pageview` (LevelUp tag) |

Contracts and rules: [site-api.md](./site-api.md). Tests:
`supabase/tests/site_payments.sql`, `payments_providers.sql`, `text_limits.sql`, `site_analytics.sql`, `site_insights.sql`,
`levelup_sources.sql`, `media_storage.sql`.

Applied through the MCP (names above). After any change, run the four suites
(they always roll back and must report `0 failed`). Advisors after applying:
*RLS enabled, no policy* on `private.analytics_salt`, `private.site_visitor_bloom`,
`private.pageview_buckets` (closed to every API role, intentional); *SECURITY
DEFINER executable* for `track_pageview`, `site_ingest_payment` (anon: they
authenticate by origin / server key) and the `site_payments_*`,
`site_project_requests_*`, `site_owned_*`, `site_studio_summary` readers
(authenticated: each checks membership, role and MFA itself).

## Billing, plans and limits (billing_*)

LevelUp sets every price; clients see what they owe, download their invoices and receipts,
and pay outside the app (online payment by card is built and switched off, see
[billing.md](./billing.md)). Money is an integer in minor units (cents) with a lower-case
ISO currency. Amounts are always computed by the database.

| Table | Holds | Read | Write |
|---|---|---|---|
| `plans` | key, name, description, `price_monthly` (null = *price to be set by LevelUp*, never shown as a number; 0 = free), currency, `limits` jsonb (`team_members`, `assistant_requests_month`, `media_mb`, `websites`; null = unlimited), `features` (keys translated by `billing.features.*`), order, `active`, one `is_default` | staff (RLS); clients through `billing_summary` | `admin_save_plan` |
| `organization_billing` | one row per organization: `plan_key`, `custom_price` (overrides the plan price), currency, `billing_note` (shown to the client's owners and admins), `next_due_date`, `status` (`active` / `trial` / `past_due` / `suspended`). No row = default plan | staff; clients through `billing_summary` | `admin_set_org_billing`, `admin_decide_upgrade_request` |
| `discounts`, `discount_redemptions` | organization discounts (no code, apply at once, e.g. label *Partner*) and promo codes (apply once redeemed; single use per organization; `max_uses` counts organizations for codes and charges for organization discounts) | staff | `admin_save_discount`, `admin_set_discount_active`, `redeem_discount_code` |
| `billing_charges` | what the client owes: label, kind (`setup` / `subscription` / `one_off`), `base_amount`, the discount applied (`discount_label`, `discount_amount`), `amount` (generated), due date, `due` / `paid` / `void` (`overdue` is reported for a due charge past its date); `invoice_number` (`LU-2026-0001`, assigned by the database, never changes), `issued_on`; when paid: `payment_method`, `payment_reference`, `paid_amount` (and the Stripe session for online payments) | staff; owners and admins through `billing_summary` and `billing_charge_document` | `admin_create_charge`, `admin_update_charge` (due only), `admin_void_charge`, `admin_record_charge_payment` (`admin_mark_charge_paid` = method `other`), `billing_ingest_stripe_event` |
| `billing_issuers` | LevelUp's legal name, address, e-mail, tax number for invoices (one row, empty until staff fill it) | staff | `admin_save_billing_issuer` |
| `billing_payment_events` | every Stripe event received (idempotency, outcome) | staff | `billing_ingest_stripe_event` |
| `plan_upgrade_requests` | plan changes asked from Billing (one pending per organization) | staff (`admin_list_upgrade_requests`) | `request_plan_upgrade`, `admin_decide_upgrade_request` |

Rules:

- **Who sees what.** `billing_summary(org)` answers every member (viewer and up) with the
  plan, its limits, the usage meters and the plan catalog. Prices, discounts, charges,
  the note, the due date and the total due (`money`) are returned to **owners and admins
  only**: editors and viewers see their plan, not the money. The navigation lists Billing
  for owners and admins; limit notices link every member to it.
- **Discounts never stack.** A charge gets the single best discount in effect (largest
  reduction) that applies to its kind and currency (`fixed` discounts only in their own
  currency). Percent discounts round half up to the cent; a fixed discount never goes
  past the charge. A subscription charge without an amount uses the organization's
  monthly price and is refused while that price is not set (`price_not_set`).
- **Promo codes** are redeemed by owners and admins (`redeem_discount_code`), 5 attempts
  per organization and 10 per account per hour (failures count: the function answers
  `invalid` / `already_redeemed` instead of raising).
- **Limits.** `private.assert_within_limit(org, key, current, adding = 1)` raises
  `plan_limit_reached` (errcode `PT402`, detail `{"key", "limit", "plan"}`), shown by the
  dashboard as *Your plan allows N … Upgrade to do more.* Enforced in
  `create_organization_invitation` and `add_organization_member` (members + live
  invitations; re-inviting a pending address keeps its seat; accepting never checks) and
  in `assistant_consume` (monthly requests, UTC month, on top of the 60 per day cap).
  `media_mb` is enforced on media uploads (`media_check_upload`, the Storage insert policy
  and the media index trigger; `private.org_storage` reads `private.org_storage_usage`, see
  [billing.md](./billing.md#storage-limit-plan-limitsmedia_mb)). `websites` is measured and
  shown but not enforced: websites are created by LevelUp.
- **Audit.** Every staff change and every client redemption or request writes
  `hq_audit_log` (`billing.*`); discounts are logged on their organization (or with no
  target type for a promo code), plans with the plan key as target id.

Plan limit `emails_month` (campaign and test e-mails per UTC month; free 500, starter 2,500, pro 10,000, business 50,000) is enforced by the email campaign functions, see [email-campaigns.md](./email-campaigns.md).

Test: `supabase/tests/billing.sql` (67 checks). `team_invitations.sql` puts its test
organization on an unlimited-seat plan so it keeps testing invitations only.

## Client portal (client_portal)

A private space on a client website for its paying customers (Black Pater's
*Espace client*). Customers are **not** accounts of the shared sign-in: they are
`portal_customers` rows (one per website + e-mail), created when a payment of that
website becomes `paid` (trigger on `site_payments`, an *access* e-mail is queued) or
when an editor invites them from the dashboard (*Client portal*).

| Object | Holds | Read | Write |
|---|---|---|---|
| `portal_customers` | e-mail (lower case), every verified address (`payment_emails`), name, locale, source, invited offer, status | editors+ (RLS) | trigger, `portal_admin_invite`, `portal_admin_set_customer_status`, `portal_email_change_confirm` |
| `portal_items` | updates, trips (dates, meeting point, steps), documents, checklists; audience one customer / an offer / everyone | editors+ | `portal_admin_publish`, `portal_admin_archive_item` (no delete) |
| `portal_item_states`, `portal_messages` | read state and ticked checklist items per customer; the message thread | editors+ | customer functions, `portal_admin_reply` |
| `private.portal_codes`, `portal_passwords`, `portal_sessions` | sign-in codes (sha256 of id + code), bcrypt passwords, session tokens (sha256) | nobody (private schema) | SECURITY DEFINER functions only |
| `private.portal_outbox` | e-mails the website must send (access, update, message, new sign-in) | nobody | queued by the functions above, drained by the website (`portal_outbox_claim` / `_complete`) |

**Customer functions** take the website's server key (`p_key`, scope `portal:access`,
shown as *Client portal* in Developers → Server keys) and, once signed in, the
customer's session token. Only the website's server calls them; the browser never
sees the key.

- `portal_request_code` → `{ send:false }` for an address without access (the visitor
  always sees the same message) or `{ send:true, code, email, locale }`; 6 digits, 10
  minutes, single use, a newer code replaces the older one, 5 wrong tries kill it;
  5 codes per address, 20 per client (hashed IP) and 300 per website per hour.
- `portal_verify_code`, `portal_password_sign_in` → `{ ok:false, reason:'invalid' }` for
  every failure (unknown address, wrong code or password); 10 tries per address and
  30 per client per hour; sessions last 7 days, each sign-in queues a *new sign-in*
  e-mail (device, time).
- `portal_set_password` (fresh code, ≥ 10 characters, bcrypt cost 12, signs out the
  other devices), `portal_email_change_start` / `_confirm` (codes to the old **and** the
  new address), `portal_sign_out(all)`.
- `portal_home` (customer, bookings from `site_payments`, visible items with read state,
  messages), `portal_mark_read`, `portal_set_checklist`, `portal_send_message`
  (4000 characters, 10/hour, 30/day), `portal_document_ticket`, `portal_payment_reference`.

**Documents**: bucket `portal-documents` (private, 10 MB, PDF / JPEG / PNG / WebP),
`org/<org>/site/<website>/<uuid>.<ext>`; editors+ upload and read. Customers never read
Storage: `portal_document_ticket` opens a 60-second ticket for one object, then the
website's server asks Storage for a 60-second signed URL with the publishable key; the
anon policy matches only the `object.sign` operation of a ticketed object (no listing,
no download).

**Dashboard**: *My site → Client portal* (`/dashboard/site/client-portal`, editors and
up, feature `client_portal`): customers with their payments and offer, revoke / give
back access, invite by e-mail, publish (update, trip, document, checklist) to one
customer / an offer group / everyone, message threads with replies. After a change
that queues e-mails the browser calls `POST /api/portal/notify`, which signs a
"send now" call to the website's `notify_url` (feature config) with
`PORTAL_NOTIFY_SECRET` (HMAC-SHA256 of `<timestamp>.<body>`, header
`X-Portal-Signature: t=…,v1=…`). The dashboard never sends portal e-mails: the client
website sends them with its own e-mail provider key.

Test: `supabase/tests/client_portal.sql` (93 checks).

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
  `private.is_platform_admin()` is true only on an **aal2** session (`platform_admin_aal2`).
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
| `media` (public) | website media library | 10 MB | jpeg, png, webp, gif, avif, pdf, mp4, webm | `org/<org id>/site/<website id>/<yyyy>/<mm>/<uuid>.<ext>` (editor+ upload, members list) |

The bucket limits are enforced by Supabase Storage for every client. The dashboard checks
the same rules before uploading (`src/lib/brand-images.ts`, `uploadMedia` in
`src/features/site/api/service.ts`) and also reads the first bytes of the file
(`src/lib/file-signature.ts`): the content must be one of the allowed formats **and**
the declared one, so a renamed HTML or SVG file is refused. **SVG is never accepted**
(it can carry scripts; there is no sanitizer). Brand images are re-encoded to a 512 px
WebP in the browser (any picked PNG/JPEG/WebP up to 8 MB, stored file ≤ 2 MB). There is
no upload route handler: files go straight to Storage as the signed-in user.

## Media storage (media_storage)

Built for thousands of files per website and many websites per organization.

**Layout and rights (storage policies).**

- New objects: `org/<organization id>/site/<website id>/<yyyy>/<mm>/<uuid>.<ext>` and the
  thumbnail `…/<uuid>_thumb.webp` (`private.media_path_ok`: lowercase UUIDs, month 01–12,
  extension in the allow-list, no traversal, no double extension).
- Upload (`media_objects_insert`): `private.can_upload_media_path` — new layout only, the
  website belongs to the organization in the path and is not archived, caller is
  **editor or above** (platform admins as admin). The contract gate (restrictive policies)
  reads the organization from both layouts (`private.media_object_org`).
- List / read through the API and delete: members of that organization
  (`private.can_access_media_path`, viewer to list, editor to delete), both layouts.
  Files uploaded before this migration keep `<org>/<site>/<file>` and stay readable and
  deletable; nothing new is written there.
- **Immutable objects**: the update policy is `false` (no overwrite, no move). Every
  upload gets a new name, so the dashboard sends `Cache-Control: max-age=31536000` and
  the CDN can keep files for a year.
- The bucket is **public** (published site images are linked from public pages): a file
  is readable by anyone who has its URL (UUID names, not guessable), but nobody can
  list another organization's files, and the `contracts` bucket stays private.
  Covered by `supabase/tests/media_storage.sql`.

**Browser optimization before upload** (`src/lib/media/optimize-image.ts`, no dependency):
images up to 30 MB / 50 megapixels are decoded with `createImageBitmap` (EXIF
orientation applied), resized to a 2400 px long edge, re-encoded to WebP (JPEG, or PNG
when transparent, where the browser cannot encode WebP, e.g. Safari) — re-encoding drops
EXIF, GPS, XMP and ICC metadata. GIF keeps its bytes (animation). A 512 px WebP thumbnail
is uploaded next to the file: the Free plan has no on-the-fly image transformations, so
the library grid never downloads full-size images. When the project moves to Pro, the
grid can switch to `getPublicUrl(path, { transform })` and stop generating thumbnails.

**Media index (`public.media`).** One row per library file, inserted by the browser
after the upload. The `media_before_insert` trigger refuses a row unless the stored
object exists in the new layout inside the row's organization / website, then **copies
size and type from Storage** (the browser cannot under-report them) and checks the
extension matches the type; `thumb_path` must be the `_thumb.webp` sibling (its size goes
to `thumb_size_bytes`). Clients may only update `alt_text` and `filename`.

| Function | Who | Returns |
|---|---|---|
| `media_list(website, kind, search, before_created_at, before_id, limit ≤ 100)` | members (viewer+) | `{ rows, next }`: newest first, cursor = `{created_at, id}` of the last row (index `media_site_cursor_idx`); `kind` = `image` / `video` / `document`; `search` matches file name or alt text (wildcards escaped) |
| `media_library_stats(website)` | members | `{ files, bytes, images, videos, documents }` of one website (bytes include thumbnails) |
| `org_storage_usage(p_org uuid)` | members of `p_org` | one row: `bytes`, `files`, `media_bytes`, `media_files`, `thumbnail_bytes`, `brand_bytes` |
| `private.org_storage_usage(p_org uuid)` | SECURITY DEFINER functions only | same, without the membership check (for plan limits) |

`org_storage_usage` measures the **stored objects** (`storage.objects`, current versions),
not the index, so a file uploaded without its row still counts: `bytes` = media library
(both layouts, thumbnails included) + organization logos (`brand/orgs/<org>/`); `files` =
objects that are not thumbnails. Contract PDFs are not counted. It uses range scans on the
`(bucket_id, name COLLATE "C")` index, so it stays fast at any size. Billing:
`private.org_storage(org)` (plan limit `media_mb`) returns
`select bytes, media_files from private.org_storage_usage(org)` (`media_storage_limit`).

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
