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
| `20261007140000` | tenant_foundation | **Pending** — review, then `supabase db push` |

After applying, run the isolation suite in
[`supabase/tests/tenant_isolation.sql`](../supabase/tests/tenant_isolation.sql) in the
SQL editor. It always rolls back; the error message is the report and must show
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
