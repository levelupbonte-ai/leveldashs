# Contracts

Clients sign their LevelUp agreement (Master Services Agreement + order form) in the
dashboard, and finish the setup steps LevelUp marks as blocking, before using the rest
of the dashboard. Existing clients are never locked unless LevelUp sends them a
**required** contract or marks a task as blocking.

## Data model (migration `20261011130000_contracts`, seed `20261011130100`)

| Table | Content | Access |
|---|---|---|
| `contract_templates` | `key` (`msa`, `order_form`), `version`, `locale` (`en` official / `fr` translation), `title`, Markdown `body`, `published_at` | platform admins read; written only by `admin_publish_contract_template`; published rows are immutable (trigger) |
| `contracts` | one per organization (optionally per website): template key + version, frozen snapshot (`body` = English, `translated_body` = French), `order_form` (JSON), `status` `draft → sent → signed → void / superseded`, `required`, `sent_at`, `signed_at`, `document_hash`, `emailed_at` | members (viewer+) read non-drafts of their organization; staff read all; **no write policy** (RPCs only); after `sent` the snapshot is frozen and status changes are checked by a trigger |
| `contract_signatures` | signer `user_id`, e-mail, typed full name + title, consent, optional drawn signature (SVG path data, `M`/`L` + integers, ≤ 20 000 chars), `ip`, `user_agent`, `signed_at` (database time), `document_hash` | members read; inserted **only** by `sign_contract`; immutable (trigger blocks update/delete even for the table owner) |
| `organization_required_tasks` | `task` (`profile`, `logo`, `mfa`), `required` | members read; written by `admin_set_required_tasks` |
| Storage `contracts` (private, 5 MB, PDF only) | `<organization id>/<contract id>.pdf` archive copy | members read; owners/admins insert once a contract is signed; no update/delete |

The order form keeps known keys only (`projectName`, `packageName`, `scope[]`,
`buildPrice`, `paymentSchedule`, `monthlyPlan`, `monthlyPrice`, `startDate`, `notes`;
amounts in USD) and gets `client` (organization name) when sent.

### Document hash

`document_hash` = SHA-256 (hex) of the UTF-8 string
`body || '\n\n' || coalesce(translated_body, '') || '\n\n' || order_form::text`
(`private.contract_document_hash`). It is computed when the contract is sent, re-checked
by `sign_contract` and copied into the signature. The English text prevails; the French
translation is part of what the client reviewed, so it is in the hash too.

## RPCs

Staff (platform admin + aal2 via `private.assert_platform_admin`):

- `admin_create_contract(org, template_key, website, locale, order_form, required)` — draft from the latest published English version (+ French of the same version)
- `admin_update_contract(id, order_form, required, website, locale)` — drafts only
- `admin_send_contract(id)` — freezes, hashes, sets `sent`, voids an unsigned contract of the same kind for the same organization/website, returns owners/admins to notify (the route `POST /api/contracts/[id]/send` e-mails them)
- `admin_void_contract(id, reason)`, `admin_set_contract_required(id, bool)` (let a client in before signing, or lock again)
- `admin_reissue_contract(id)` — new draft from the newest template version with the same order form
- `admin_set_required_tasks(org, tasks[])`
- `admin_publish_contract_template(key, locale, title, body, version?)` — English without version = next version; French names the English version it translates

Client:

- `sign_contract(contract_id, full_name, title, drawn_signature, consent, document_hash)` — caller must be an **owner or admin member** (staff never sign for a client), `assert_mfa()`, contract `sent`, consent true, stored hash = recomputed hash = hash the client reviewed. IP from `cf-connecting-ip` / first `x-forwarded-for` / `x-real-ip`, user agent from the request headers PostgREST exposes (`request.headers`). The browser calls it directly so these are the signer's own. The previous signed contract of the same kind becomes `superseded` (its signature stays).
- `mark_contract_emailed(id)` — true only the first time (signer or staff), so the signed copy is e-mailed once.
- `org_access_state(org)` → `active | contract_required | tasks_required | suspended` (null for non-members; always `active` for staff). `suspended` follows `organizations.status = 'suspended'` (reserved for billing).
- `dashboard_access(org?)` → `{ organization_id, state, pending_tasks, has_contracts }` for the active organization cookie (or the first organization by name, like the session).

## Gate

- **Proxy** (`src/lib/supabase/proxy.ts`, every request): for `/dashboard/*` outside
  `/dashboard/contract` and `/dashboard/profile`, calls `dashboard_access`; any state
  other than `active` redirects to `/dashboard/contract`. This runs on client-side
  navigations too (layouts are not re-rendered on soft navigation, the proxy is).
- **Session** (`getDashboardSession().access`): the layout passes it to the client;
  `AccessGate` redirects pages served from the client router cache; the navigation shows
  only items marked `whenLocked` (Account → Contract, Profile). Sign out stays in the user menu.
- **Database**: restrictive policies refuse insert/update/delete on `website_settings`,
  `content_blocks`, `team_members`, `services`, `gallery_items`, `reviews`, `faq_items`,
  `announcements`, `media`, `websites` (update) and Storage `media` objects while
  `private.org_contract_locked(org)` (required contract in `sent`, caller not staff).
  Organization name/logo and the profile stay editable (they are setup tasks); the inbox
  (appointments, waitlist, requests) is not blocked so customers keep being served.
  Future write RPCs on client content should call `private.assert_org_unlocked(org)`.
- If `dashboard_access` fails, the UI gate stays open (fail-open); RLS still applies.

## Screens

- `/dashboard/contract` (`src/features/contracts`): steps Review → Sign → Done, the
  agreement (tabs English official / Français translation, rendered by the safe Markdown
  renderer `src/components/markdown.tsx` + `src/lib/markdown.ts`: no raw HTML, only
  http(s)/mailto links), order form card, typed name + title, consent checkbox with the
  ESIGN / California UETA consent sentence, optional pointer-events signature pad, success
  state with PDF download, history, “Tasks to complete”. Viewers/editors see “Waiting for
  a signature”.
- `/dashboard/exclusive/contracts` (`src/features/platform-admin/components/contracts-admin.tsx`,
  staff messages only): pick a client, create/edit draft, preview, send, require/let in,
  void, re-issue, certificate + PDF, blocking tasks, publish template versions.

## PDF and e-mail

- `GET /api/contracts/[id]/pdf` — generated on demand from the database record (pdf-lib,
  standard fonts, US Letter): cover + order form, official English text, French
  translation, signature certificate (names, UTC times, IP, user agent, consent, contract
  id, SHA-256, typed and drawn signature). Labels in `emails.contract.pdf`. Standard fonts
  cover Latin-1/WinAnsi; other characters print as `?`.
- `POST /api/contracts/[id]/finalize` — after signing: archives the PDF in the private
  bucket and, once (`mark_contract_emailed`), e-mails it as an attachment to the signer
  (their language) and to contact@levelup-ecosystem.com (English) via Resend
  (`sendNotice`). Without `RESEND_API_KEY` nothing is sent and a warning is logged; the
  signature is still valid and the PDF downloadable.

## Tests

`supabase/tests/contracts.sql` (rolled back; must report `0 failed`): RLS isolation,
no direct insert/update/delete of signatures, frozen snapshot, `sign_contract` checks
(role, consent, hash, drawn path, double signature, IP/UA capture), gate states, content
writes refused while locked, staff exempt, re-issue + supersede, blocking tasks.
