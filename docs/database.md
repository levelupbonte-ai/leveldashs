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
| `appointments`, `waitlist_entries`, `form_submissions` | customer interactions | **no direct access** — RPCs only | viewer read, editor updates status/notes, admin deletes |
| `studio_templates`, `studio_projects`, `studio_usage` | LevelStudio | published starter/style templates | owner reads own; writes via LevelStudio server |

Public RPCs (callable with the publishable key): `get_public_website`,
`submit_form`, `book_appointment`, `join_waitlist`, `get_public_waitlist`,
`get_ticket_status`. They check that the website is live and the feature is
enabled, take prices/names from the database (never from the browser),
rate-limit (5/hour per contact, 300/hour per site) and return ticket codes
instead of row ids. Errors use PostgREST status codes (`PT403`, `PT404`,
`PT409`, `PT429`).

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
- `public.get_public_website(website_id)` — public config of an **active** website
  (name, domain, enabled features). Callable by `anon`.
- Platform staff are listed in `platform_admins` (insert with the service role only).
  Since `platform_admin_management`, `private.has_org_role()` grants them any role
  up to `admin` in every non-archived organization, so content, inbox, media and
  Storage policies apply to them without extra policies. Owner-only actions stay
  with the client's real owners.

Note: deleting an auth user who is the last owner of an organization is blocked
until ownership is transferred.

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
