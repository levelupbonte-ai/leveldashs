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
| LevelUp (service role / API) | Create websites, change status/domain, enable features |

- RLS helpers live in the `private` schema (not exposed by the Data API).
- Column-level grants stop clients from changing ownership, website status,
  domains or feature flags even where a row is updatable.
- `public.create_organization(name, slug)` — creates an org and makes the caller
  owner (max 5 owned orgs per user).
- `public.get_public_website(website_id)` — public config of an **active** website
  (name, domain, enabled features). Callable by `anon`.
- Platform staff are listed in `platform_admins` (insert with the service role only).

Note: deleting an auth user who is the last owner of an organization is blocked
until ownership is transferred.

## Secrets

- Browser: only the project URL and the **publishable/anon** key.
- Server only: `SUPABASE_SECRET_KEY` / service role. Never prefix it with `NEXT_PUBLIC_`.
