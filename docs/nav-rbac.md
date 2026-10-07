# Navigation RBAC

## Overview

Sidebar and Cmd+K items are filtered client-side from the dashboard session (organization
role, LevelUp platform-admin status and the features enabled on the active website).

**Key insight**: navigation visibility is UX only, not security. Every read and write goes
to Supabase as the signed-in user and is enforced by Row Level Security (see
[database.md](./database.md)). Pages that must not exist for a user check the session
server-side (e.g. `/dashboard/exclusive` calls `notFound()` for non platform admins).

## Core Files

1. **`src/config/nav-config.ts`** — navigation groups and items with `access` rules
2. **`src/hooks/use-nav.ts`** — `useFilteredNavItems()` / `useFilteredNavGroups()`
3. **`src/types/index.ts`** — `PermissionCheck` (the `access` type) and `NavItem`
4. **`src/lib/auth/session-context.tsx`** — `useDashboardSession()`, provided by
   `src/app/dashboard/layout.tsx` from `requireDashboardSession()` (see [auth.md](./auth.md))
5. **`src/lib/auth/types.ts`** — `OrgRole`, `ROLE_RANK`, `hasRole()`

The session is loaded once on the server by the `/dashboard` layout, so filtering is
synchronous: no client fetch, no loading state, no flashing.

## Access Properties

| Key | Type | Visible when |
|---|---|---|
| `requireOrg` | `boolean` | An active organization is selected |
| `requireWebsite` | `boolean` | A website of the active organization is selected |
| `role` | `'viewer' \| 'editor' \| 'admin' \| 'owner'` | The user's role in the active organization is at least this one (`owner > admin > editor > viewer`). Platform admins always pass |
| `feature` | `string \| string[]` | At least one of these `website_features` keys is enabled on the active website |
| `platformAdmin` | `boolean` | The user is in `platform_admins` (LevelUp staff) |

Items without `access` are always visible. All keys on an item must pass. For an item with
children, each child is filtered with its own `access` too.

## Usage

```typescript
{
  title: 'Rendez-vous',
  url: '/dashboard/site/appointments',
  icon: 'calendar',
  items: [],
  // Only when the active website has the "bookings" feature
  access: { requireWebsite: true, feature: 'bookings' }
}

{
  title: 'Annonces',
  url: '/dashboard/site/announcements',
  icon: 'speakerphone',
  // Any of these features
  access: { feature: ['announcements', 'promotions', 'blog'] }
}

{
  title: 'LevelUp admin',
  url: '#',
  icon: 'pro',
  access: { platformAdmin: true },
  items: [{ title: 'Tous les clients', url: '/dashboard/exclusive', icon: 'exclusive' }]
}
```

In components:

```typescript
import { useFilteredNavGroups } from '@/hooks/use-nav';

const groups = useFilteredNavGroups(navGroups);
```

## Website Features

Feature keys come from the `features` catalog and are switched on per website in
`website_features` (by LevelUp, not by clients). The same keys gate the `/dashboard/site`
pages server-side: `SitePage` / `loadSitePage(feature)` show an "unavailable" state when
the feature is off, and the content collections in `src/features/site/config/collections.ts`
declare their own `feature`.

## Platform Admins

LevelUp staff listed in `platform_admins`:

- see every organization in the switcher (RLS allows it)
- pass every `role` check in the navigation
- act with up to `admin` rights in every organization in the database (never `owner`)
- are the only ones who see `platformAdmin` items

## Adding a New Access Type

1. Add the key to `PermissionCheck` in `src/types/index.ts`
2. Add the data it needs to `DashboardSession` (`src/lib/auth/types.ts` +
   `src/lib/auth/session.ts`) if it is not there yet
3. Add the check to `allowed()` in `src/hooks/use-nav.ts`
4. Make sure RLS (or a server-side page check) enforces the same rule
