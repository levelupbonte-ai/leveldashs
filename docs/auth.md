# Authentication (Supabase Auth)

The dashboard signs users in with **Supabase Auth** on the shared LevelUp Ecosystem
project (see [database.md](./database.md)). There is no separate auth provider and no
backend of our own in between: the browser and the server both talk to Supabase as the
signed-in user, so **Row Level Security decides what every query can read or write**.

The UI is in French (`Connexion`, `Inscription`, `Mot de passe oublié`, …); code and
docs are in English.

## Environment

```env
NEXT_PUBLIC_SUPABASE_URL=https://rncuhmvykrmtxfzqpitc.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Only the project URL and the **publishable** key are used (`src/lib/supabase/env.ts`;
`NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted as a fallback). The app never uses the
secret / service-role key — never add it to this project.

## Supabase clients

| File | Use |
|---|---|
| `src/lib/supabase/client.ts` | Browser client (`createBrowserClient`, singleton) for client components and React Query hooks |
| `src/lib/supabase/server.ts` | Cookie-bound server client (`server-only`) for Server Components, route handlers and server actions |
| `src/lib/supabase/proxy.ts` | `updateSession(request)`: refreshes the auth cookies on every request and redirects signed-out users from `/dashboard/*` to `/auth/sign-in?next=<path>` |

`src/proxy.ts` (Next.js 16 proxy, formerly middleware) calls `updateSession` for every
non-static route. It uses `auth.getUser()`, which validates the token with Supabase
(`getSession()` would not).

## Auth pages

| Route | What it does |
|---|---|
| `/auth/sign-in` | Email + password, "Continue with Google", password reset link |
| `/auth/sign-up` | Email + password + full name (stored in `user_metadata.full_name`), Google |
| `/auth/callback` | Route handler: exchanges the OAuth/PKCE `code` (`exchangeCodeForSession`) or verifies e-mail links (`token_hash` + `type` via `verifyOtp`), then redirects to `next` |

- The form lives in `src/features/auth/components/user-auth-form.tsx`.
- `next` is always passed through `safeNext()` (`src/lib/auth/redirect.ts`), which only
  accepts same-origin relative paths (blocks `//evil.com`, `/\evil.com`, absolute URLs).
  Default destination: `/dashboard/site`.
- If e-mail confirmation is on, sign-up shows a notice and the confirmation link lands on
  `/auth/callback`. Password reset links go to `/dashboard/profile?reset=1`, where the
  user sets a new password (`auth.updateUser`).
- A failed callback redirects to `/auth/sign-in?error=callback`.

## Supabase dashboard setup

1. **Authentication → URL Configuration**
   - Site URL: `https://<dashboard-domain>`
   - Redirect URLs: `https://<dashboard-domain>/auth/callback` and
     `http://localhost:3000/auth/callback` (add preview domains if needed)
2. **Authentication → Providers → Google**: enable it with a Google Cloud OAuth client
   (type "Web application") whose authorized redirect URI is
   `https://rncuhmvykrmtxfzqpitc.supabase.co/auth/v1/callback`. Avatars come from
   `lh3.googleusercontent.com` (allowed in `next.config.ts`).
3. **Authentication → Emails** (optional): configure custom SMTP so confirmation and
   reset e-mails are sent from a LevelUp address instead of the rate-limited default
   sender, and adapt the templates (French).

## Session, organizations and websites

`src/lib/auth/session.ts` (server-only, cached per request):

- `getDashboardSession()` returns `null` when signed out, otherwise the user, profile
  (`profiles.full_name`, `avatar_url`), `isPlatformAdmin` (row in `platform_admins`),
  the organizations the user belongs to (via `organization_members`; platform admins see
  every non-archived organization) with the user's role, the active organization, its
  websites (with enabled `website_features` keys) and the active website.
- `requireDashboardSession()` does the same or redirects to `/auth/sign-in`. The
  `/dashboard` layout calls it and passes the session to `SessionProvider`.

The active organization and website are stored in httpOnly cookies `lu_org` and
`lu_site` (`src/lib/auth/cookies.ts`). They only choose among rows RLS already returns.
They are changed through server actions in `src/lib/auth/actions.ts`:

- `setActiveOrganization(organizationId)` — validates the UUID and that RLS returns the
  organization, then resets the website cookie
- `setActiveWebsite(websiteId)` — validates the `ws_…` id and that RLS returns the
  website, then sets both cookies
- `signOut()` — signs out of Supabase, clears both cookies, redirects to sign-in

Client components read the session with `useDashboardSession()` (or
`useActiveWebsite()`) from `src/lib/auth/session-context.tsx`.

## Roles

Defined in `src/lib/auth/types.ts`: `owner > admin > editor > viewer` (`hasRole(role, min)`).

| Role | Typical use |
|---|---|
| `viewer` | Read site content, settings, inbox (appointments, waitlist, requests), media |
| `editor` | + edit content, website settings and content blocks, upload media, update inbox status/notes |
| `admin` | + delete inbox entries, rename the organization / websites, manage non-owner members |
| `owner` | + grant or remove `owner` (an organization always keeps at least one owner) |

**Platform admins** (LevelUp staff, table `platform_admins`) act with up to `admin`
rights in every organization (migration `platform_admin_management`) but never as
`owner`. They also see the "LevelUp admin → Tous les clients" page (`/dashboard/exclusive`,
`notFound()` for everyone else).

The exact rules live in RLS policies; see the Authorization section of
[database.md](./database.md). Navigation filtering is described in
[nav-rbac.md](./nav-rbac.md).

## Organizations & team

`src/features/organizations`:

- `/dashboard/workspaces` — list of the user's organizations, switch the active one,
  create one with the `create_organization` RPC (caller becomes owner)
- `/dashboard/workspaces/team` — members and roles; add someone by e-mail with the
  `add_organization_member` RPC. The person must **already have an account** (the RPC
  returns `not_found` otherwise); there are no e-mail invitations.

Billing is not handled in the app: `/dashboard/billing` is a static page saying billing
is managed by LevelUp (contact@levelup-ecosystem.com).

## LevelUp auth e-mails (Send Email Hook)

Supabase does not send auth e-mails itself: the **Send Email Hook** calls
`POST /api/auth/email-hook`, which verifies the Standard Webhooks signature and
sends LevelUp-branded French e-mails through Resend (`src/lib/email/auth-emails.ts`).
Links point to `/auth/callback?token_hash=…&type=…&next=…` on this dashboard.

- Password reset → `/auth/reset-password` (new password form, `updateUser`).
- Magic link → "Recevoir un lien de connexion" on the sign-in page (existing accounts only).

Setup: Supabase → Authentication → Hooks → Send Email → HTTPS
`https://dashboard.levelup-ecosystem.com/api/auth/email-hook`, generate the
secret, then set on Vercel (leveldashs): `SEND_EMAIL_HOOK_SECRET` (the
`v1,whsec_…` value) and `RESEND_API_KEY`. Optional `AUTH_EMAIL_FROM`
(default `LevelUp Ecosystem <account@levelup-ecosystem.com>`, a verified Resend domain).
