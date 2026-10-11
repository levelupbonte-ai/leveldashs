# Authentication (Supabase Auth)

The dashboard signs users in with **Supabase Auth** on the shared LevelUp Ecosystem
project (see [database.md](./database.md)). There is no separate auth provider and no
backend of our own in between: the browser and the server both talk to Supabase as the
signed-in user, so **Row Level Security decides what every query can read or write**.

The UI is in English (official language) with a French translation (see
[i18n.md](./i18n.md)); code and docs are in English.

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
| `/auth/sign-in` | Email + password, the official Google button (Google Identity Services) and "Continue with a passkey" when enabled in Supabase, password reset link |
| `/auth/sign-up` | Email + password + full name (stored in `user_metadata.full_name`), Google when enabled |
| `/auth/verified` | Landing page of the sign-up confirmation link: "Congratulations, your email is verified", go back to the first device or "Continue here" (`next`, default `/auth/onboarding`) |
| `/auth/pending` | "Your account is being reviewed": one paragraph, the request (business name + date), the typical delay, the e-mail to expect, "Edit request", "Sign out", contact link. Rejected requests: "We couldn’t approve your request", "Contact LevelUp", "Sign out" |
| `/auth/mfa` | Second step for accounts with an authenticator app: 6-digit TOTP code (`mfa.challengeAndVerify`), keeps `next` |
| `/auth/callback` | Route handler: exchanges the OAuth/PKCE `code` (`exchangeCodeForSession`) or verifies e-mail links (`token_hash` + `type` via `verifyOtp`), then redirects to `next` |

- The form lives in `src/features/auth/components/user-auth-form.tsx`.
- `next` is always passed through `safeNext()` (`src/lib/auth/redirect.ts`), which only
  accepts same-origin relative paths (blocks `//evil.com`, `/\evil.com`, absolute URLs).
  Default destination: `/dashboard/site`.
- If e-mail confirmation is on, sign-up shows a notice and the confirmation link lands on
  `/auth/callback`, then `/auth/verified` (see *Cross-device e-mail verification*). Password reset links go to `/dashboard/profile?reset=1`, where the
  user sets a new password (`auth.updateUser`).
- A failed callback redirects to `/auth/sign-in?error=callback`.

## Supabase dashboard setup

1. **Authentication → URL Configuration** (exact values):
   - **Site URL**: `https://dashboard.levelup-ecosystem.com`
   - **Redirect URLs** (one per line):
     - `https://dashboard.levelup-ecosystem.com/**`
     - `https://studio.levelup-ecosystem.com/**`
     - `https://levelup-ecosystem.com/**`
     - `http://localhost:3000/**`

   Supabase matches the **whole** `redirectTo` URL, query string included, against
   these globs. Our callback URL carries `?next=…`, so an entry without `/**`
   (e.g. `…/auth/callback`) never matches; Supabase then silently uses the
   **Site URL** instead. That is how Google sign-ins ended up on the showcase
   (`levelup-ecosystem.com`) while it was the Site URL.
2. **Authentication → Providers → Google**: enable it with a Google Cloud OAuth client
   (type "Web application") whose authorized redirect URI is
   `https://rncuhmvykrmtxfzqpitc.supabase.co/auth/v1/callback`. Avatars come from
   `lh3.googleusercontent.com` (allowed in `next.config.ts`).
3. **Authentication → Emails** (optional): configure custom SMTP so confirmation and
   reset e-mails are sent from a LevelUp address instead of the rate-limited default
   sender. Templates are ours (Send Email Hook, below).

### Google redirect safety nets

The Google button normally never redirects (Google Identity Services, below). The
OAuth redirect flow (`signInWithOAuth`) is only the fallback when Google's script
cannot load. For that flow:

- **`lu_next` cookie** — just before leaving for Google, the browser stores the
  destination (`safeNext` result: a dashboard path or an https URL of another LevelUp
  app such as LevelStudio) in `lu_next` (`src/lib/auth/next-cookie.ts`): domain
  `.levelup-ecosystem.com` (host-only on localhost / previews), `Path=/`,
  `SameSite=Lax`, `Secure` on https, 10 minutes. `/auth/callback` uses it when the
  `next` query parameter is missing, always re-checks it with `safeNext()`, and deletes it.
- **Code forwarded from elsewhere** — the PKCE code verifier is also a cookie on the
  shared domain, so `/auth/callback` can exchange a `code` that first landed on another
  LevelUp host. The showcase forwards a stray `?code=` to
  `https://dashboard.levelup-ecosystem.com/auth/callback?code=…`, and the dashboard
  proxy forwards `/?code=…` (Site URL fallback) to `/auth/callback`.
- **Callback input** — `code`, `token_hash`, `type` and `next` are validated with Zod
  (format, length) before anything reaches Supabase; any failure goes to
  `/auth/sign-in?error=callback`.

The GIS path needs none of this: after `signInWithIdToken` the session cookies are
written on the shared domain and `goTo()` sends the browser to `safeNext(next)`, with a
full page load (`window.location.assign`) when it is another LevelUp app (LevelStudio).

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

## Session lifetime and inactivity

- **Inactivity sign-out (dashboard)** — `IdleTimeout`
  (`src/features/auth/components/idle-timeout.tsx`, mounted by the `/dashboard` layout)
  signs the browser out after **30 minutes** without activity (pointer, keyboard, wheel,
  touch, scroll). At **28 minutes** an "Are you still there?" dialog counts down with
  *Stay signed in* / *Sign out now*; while it is open only the button counts as activity.
  Tabs share the last activity in `localStorage.lu_last_activity` (`storage` event) and
  a `BroadcastChannel('lu-session')`, so working in one tab keeps the others alive and
  an automatic sign-out closes every tab. The sign-out is the `signOutIdle()` server
  action: `auth.signOut({ scope: 'local' })` (this browser only; other devices keep
  their session), clears `lu_org` / `lu_site`, then `/auth/sign-in?reason=idle`, which
  explains what happened. Opening a dashboard page counts as activity; a laptop that
  wakes up after more than 30 minutes is signed out on the next check.
- **Server-side re-validation** — every request goes through the proxy, which calls
  `auth.getUser()` (validated by Supabase Auth, never a bare cookie), and server pages
  use `getDashboardSession()` the same way. A revoked or expired session is signed out
  on the next request even if a tab stayed open.
- The manual *Sign out* menu entry keeps `scope: 'global'` (every device, every LevelUp
  app); Profile → *Sign out of all devices* does the same explicitly.

### Recommended Supabase Auth session settings

Supabase → **Authentication → Sessions** (and *JWT Keys* for the expiry):

| Setting | Recommended | Plan |
|---|---|---|
| Access token (JWT) expiry | `3600` s (1 h, default); do not raise it | Free |
| Detect and revoke compromised refresh tokens (rotation) | On | Free |
| Refresh token reuse interval | `10` s (default) | Free |
| Inactivity timeout | `8h` (server-side backstop for the 30 min client timer; applies to LevelStudio too) | **Pro** |
| Time-box user sessions | `7d` (forces a fresh sign-in weekly) | **Pro** |
| Enforce single session per user | Off (people use phone + computer) | **Pro** |

On the Free plan only the first three exist; the client-side 30 minute timer above is
then the inactivity control, and refresh tokens otherwise live until sign-out.

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
sends LevelUp-branded e-mails through Resend, in the recipient's language
(`user_metadata.locale`, English when unknown; texts in `messages/*.json` → `emails`) (`src/lib/email/auth-emails.ts`).
Links point to `/auth/callback?token_hash=…&type=…&next=…` on this dashboard.

- Password reset → `/auth/reset-password` (new password form, `updateUser`).
- Sign-up confirmation → always `/auth/verified?next=…` (the hook wraps `next`).
- Magic links are no longer offered on the sign-in page (the hook still formats them if
  Supabase sends one).

Verification (`verify()` in the route): the body is read as text (64 KB max), then
`webhook-id`, `webhook-timestamp` and `webhook-signature` are checked: timestamp within
5 minutes (non-numeric → rejected), HMAC-SHA256 over `id.timestamp.body` with the
base64 secret, constant-time comparison of every `v1,` signature. Only then is the JSON
parsed (bounded Zod schema). A missing secret rejects everything. This is the only
inbound webhook of the dashboard; any new one must verify a signature the same way.

Setup: Supabase → Authentication → Hooks → Send Email → HTTPS
`https://dashboard.levelup-ecosystem.com/api/auth/email-hook`, generate the
secret, then set on Vercel (leveldashs): `SEND_EMAIL_HOOK_SECRET` (the
`v1,whsec_…` value) and `RESEND_API_KEY`. Optional `AUTH_EMAIL_FROM`
(default `LevelUp Ecosystem <account@levelup-ecosystem.com>`, a verified Resend domain).

## Two-factor authentication (TOTP)

Supabase native MFA, authenticator apps only (Google Authenticator, 1Password, …).

- **Enroll** — Profile → *Security* (`src/features/profile/components/security-section.tsx`,
  API in `src/features/profile/api`): `mfa.enroll({ factorType: 'totp' })` shows the QR code
  (SVG data URL) and the secret, `mfa.challengeAndVerify` confirms the first code (the session
  becomes `aal2`). Factors are listed with `mfa.listFactors()`; removing one
  (`mfa.unenroll`) requires an `aal2` session.
- **Sign-in** — password, Google and passkeys only give `aal1`. When the user has a
  verified factor (`getAuthenticatorAssuranceLevel()`: `currentLevel = aal1`,
  `nextLevel = aal2`, see `src/lib/auth/mfa.ts`), the sign-in form, the sign-in/sign-up/reset-password
  pages and `/auth/callback` send them to `/auth/mfa?next=…`. `next` still goes through
  `safeNext()`; other LevelUp apps are reached with `window.location.assign`.
- **Proxy** — `src/lib/supabase/proxy.ts` redirects every `/dashboard/*` request of an
  `aal1` session that could be `aal2` to `/auth/mfa?next=<path>`.
- **Setup checklist** — the dashboard home shows a calm "Finish setting up your account"
  card (`src/components/layout/setup-checklist.tsx`): complete your profile, add your logo
  (org admins), enable two-step verification (→ `/dashboard/profile#security`). Done steps
  get a check, optional steps can be hidden (per browser); two-step verification cannot be
  hidden for platform admins and organization owners/admins (`session.mfa.required`) until
  it is on.
- **Actions that need aal2** — when the database refuses a change because the session is
  not aal2 (`AppError('mfaRequired')`), the page shows a neutral "Complete this step first"
  notice with a "Verify now" button to `/auth/mfa?next=…` (`MfaStepNotice`), not an error.
- **Sessions** — *Sign out of all devices* calls `auth.signOut({ scope: 'global' })`
  (revokes every refresh token, all LevelUp apps), then the `signOut` server action.
- **Lost authenticator** — there are no recovery codes yet (experimental in Supabase): LevelUp
  staff removes the factor from the Supabase dashboard (Authentication → Users) after
  verifying the person.
- **Passkeys** — see *Passkeys* below (sign-in method, not a second factor).

### Database rule (aal2)

Migration `20261008070000_mfa_aal2_sensitive_writes.sql` adds
`private.mfa_satisfied()` = `auth.jwt()->>'aal' = 'aal2'` **or** the user has no verified
factor in `auth.mfa_factors`, and `private.assert_mfa()` (raises `PT403`, message
containing `aal2`). It is enforced on:

- `organization_members` and `organization_invitations` insert / update / delete —
  `RESTRICTIVE` policies `*_require_aal2`, AND-ed with the existing permissive ones;
- `add_organization_member` (SECURITY DEFINER, bypasses RLS) — explicit `assert_mfa()`;
- platform-admin RPCs (`admin_create_client_site`, `admin_update_website`) through
  `private.assert_platform_admin()`.

Users without MFA are not affected. Once a factor is verified, a stolen password (aal1
session) cannot change members, roles or invitations.

### Supabase settings

- **Authentication → Multi-Factor**: *TOTP (App Authenticator)* enabled (default on hosted
  projects). Optionally limit the number of factors per user.

## CAPTCHA (Cloudflare Turnstile, optional)

When `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set, the sign-in / sign-up form renders a
Turnstile widget (`src/features/auth/components/turnstile.tsx`, script
`https://challenges.cloudflare.com/turnstile/v0/api.js`) and passes
`options.captchaToken` to `signInWithPassword`, `signUp`, `resend` and
`resetPasswordForEmail`. The automatic sign-up check (below) waits for a fresh token
before each attempt. Tokens are single-use: the widget resets after each call. Without
the variable nothing changes.

Setup (in this order, otherwise every sign-in fails):

1. Cloudflare → Turnstile → add a widget for `dashboard.levelup-ecosystem.com` (and
   `localhost` for development); copy the **site key** and the **secret key**.
2. Vercel (leveldashs): set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to the site key and redeploy.
3. Supabase → Authentication → Attack Protection → *Enable CAPTCHA protection*, provider
   **Turnstile**, paste the **secret key**.

Once CAPTCHA is on in Supabase, every password / OTP / sign-up / reset call needs a token,
so all of them must go through this dashboard (the only LevelUp sign-in page).

**Status check (2026-10-11):** a password grant sent to Supabase *without* a token was
answered `invalid_credentials`, not a CAPTCHA error: step 3 is **not done yet**, so the
widget currently shows but Supabase does not enforce it. Turn it on (step 3) now that
the site key is set in production; the dashboard already sends a token with every call.

### Anti-spam and rate limits

| Endpoint | Protection |
|---|---|
| Sign-in, sign-up, reset, resend, passkey | Turnstile token (enforced once Supabase CAPTCHA is on) + Supabase Auth rate limits (*Authentication → Rate Limits*) |
| `POST /api/access/request` (access request) | Same-origin check, Zod, honeypot field `companyUrl` (filled → fake success, nothing stored or sent), **10 submissions/edits per account per hour** (`private.hit_rate_limit`, migration `20261011100000_rate_limits.sql`, `PT429` → 429 “Too many attempts”), one team e-mail per new request |
| `POST /api/assistant`, `/api/assistant/weekly` | Same-origin + JSON only, signed-in member, daily AI allowance per organization (`assistant_consume`, `PT429`) |
| `POST /api/access/decision` | Same-origin, platform admin with an aal2 session (database) |
| `POST /api/auth/email-hook` | Standard Webhooks signature (HMAC-SHA256, 5-minute window, constant-time compare) |
| Public RPCs used by client websites | Database rate limits (5/hour per contact, 300/hour per site) |

`private.hit_rate_limit(bucket, subject, max, window)` is the generic limiter for future
authenticated endpoints: it counts rows in `private.rate_limit_events` (not exposed by the
Data API) and raises `PT429`. Rows are never pruned automatically; they are tiny.

## Dashboard access on approval

Creating an account is open (LevelStudio stays available), but `/dashboard` only
opens to members of an organization or LevelUp staff (`src/app/dashboard/layout.tsx`).

- **Invited people** join their organization automatically when they confirm
  their e-mail (`private.accept_invitations`): no approval needed.
- **Everyone else** lands on `/auth/onboarding`: profile (name, photo), then an
  access request (`submit_access_request`, table `access_requests`).
- Once a request exists, `/dashboard` (layout, `getAccessState()` in
  `src/lib/auth/access.ts`) and `/auth/onboarding` send the account to
  `/auth/pending` instead: pending or rejected, every sign-in path (password,
  Google, passkey, e-mail links, a direct visit, an already signed-in visit to
  `/auth/sign-in`) ends there, never on the profile form again.
  `/auth/onboarding?edit=1` edits a pending request (button "Modifier ma demande"). The team
  gets an e-mail; requests show on `/dashboard/exclusive` where staff approve
  (`review_access_request`: creates the client's organization, owner role) or
  reject. The applicant is e-mailed either way (`/api/access/decision`).
- `create_organization` is limited to staff and existing members, so approval
  cannot be skipped.

Sign-up runs in steps (account → e-mail check → profile → approval); forgotten
passwords have their own confirmation screen with a resend
cooldown (`/auth/forgot-password`). Avatars and organization logos are uploaded
to the public `brand` bucket (`avatars/<user>/`, `orgs/<org>/`, images only, 2 MB).

## Legal documents and acceptance

The legal pages live on the showcase (`src/lib/legal.ts`, `LEGAL_LINKS`):
`/terms`, `/privacy`, `/acceptable-use`, `/services-agreement`, `/dpa`, `/cookies`,
`/levelstudio-terms` on `https://levelup-ecosystem.com`. They are linked (new tab) at
the bottom of every auth card and error page (`LegalLinks`) and in the user menu →
*Legal* (`LegalMenuSub`).

**Acceptance is required** to create an account: "I agree to the Terms of Service,
Acceptable Use Policy and Privacy Policy" (`acceptTerms`, Zod `refine`, EN/FR).

- **E-mail sign-up** — the checkbox is required by the form schema; `signUp` sends
  `legal_version` (and an informative `legal_accepted_at`) in `user_metadata`. There is
  no session before the e-mail is confirmed, so the trigger
  `private.record_signup_legal_acceptance()` (on `auth.users` insert) writes the row
  with the **database timestamp**.
- **Google on the sign-up page** — the Google button stays disabled until the box is
  ticked; after `signInWithIdToken` the RPC `accept_legal_terms(version, 'google')`
  records it.
- **Any other new account** (Google from the sign-in page, redirect fallback) — the
  onboarding profile step shows the same required checkbox when no acceptance of the
  current version exists, and calls `accept_legal_terms(version, 'onboarding')`.

Storage: table `public.legal_acceptances` (migration
`20261011110000_legal_acceptances.sql`): `user_id`, `version` (`YYYY-MM-DD`),
`documents` (`terms`, `acceptable-use`, `privacy`), `source` (`signup` | `google` |
`onboarding`), `accepted_at` (server time), unique per user and version. RLS: users read
their own rows, platform admins read all; no insert/update/delete grants (only the RPC
and the trigger write). We chose a table over `user_metadata` because users can rewrite
their own metadata (`auth.updateUser`), which makes it worthless as a record.

**New version of the documents:** bump `LEGAL_VERSION` in `src/lib/legal.ts`. New
accounts then record the new version; existing accounts are not asked again
automatically (add a re-acceptance prompt if the change requires consent).

## Cross-device e-mail verification

People often sign up on a computer and open the confirmation e-mail on their phone.

1. Sign-up keeps the e-mail and password **in React state only** (never storage) and
   shows `SignupEmailSent` (`src/features/auth/components/signup-email-sent.tsx`).
2. `useEmailVerificationWatch` (`src/features/auth/hooks/`) retries
   `signInWithPassword` every **10 s** (30 calls / 5 min = the default per-IP sign-in
   limit; a 429 doubles the delay up to 60 s). Supabase answers `email_not_confirmed`
   until the link is clicked, then signs in on this device and the tab goes to
   `/auth/onboarding` by itself. It pauses while the tab is hidden (checks again on
   `visibilitychange`), stops after 20 minutes ("Check now" restarts it), and
   also listens to `onAuthStateChange` / `getSession` for a link opened in the same browser.
3. The link (`/auth/callback?token_hash=…`) creates a session where it is opened and
   lands on `/auth/verified`: congratulations, "go back to the device where you started",
   and a "Continue here" button.

Google sign-ups need no e-mail check.

## Sign-in methods (live Supabase settings)

There is no environment flag: `getAuthMethods()` (`src/lib/auth/auth-methods.ts`,
server-only) reads `GET {NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings` with the
publishable key (`next: { revalidate: 300 }`, 3 s timeout) and returns
`{ google: external.google, passkey: passkeys_enabled }`. The sign-in, sign-up,
onboarding and profile pages pass these flags down. Any error hides the buttons
(fail closed). Turning a provider on or off in the Supabase dashboard shows or
hides the buttons within five minutes, without a redeploy.

Layout of the sign-in form: Google and passkey buttons stacked at the top (same
outline style and height), then the "or with email" divider, then e-mail + password.

**Last method.** After a successful sign-in the browser keeps the method name in
`localStorage.lu_last_method` (`google` | `passkey` | `password`, nothing else;
`src/features/auth/lib/last-method.ts`). Google is saved right after
`signInWithIdToken`; with the redirect fallback it is marked in `sessionStorage` before the
redirect and confirmed by `RecordLastMethod` on the first signed-in page. When the
last method is Google or passkey (and still available), the sign-in page shows only that
button with a "Last used" badge; the rest folds behind "Other sign-in options".

**No Google for Google accounts.** `hasGoogleIdentity(user)` (`src/lib/auth/identities.ts`,
`identities` or `app_metadata.providers`) hides the Google button when the browser
session already belongs to a Google account. Signed-in visitors never see the sign-in /
sign-up forms anyway (both pages redirect), and the onboarding, pending and MFA screens
have no Google button.

### Google button (Google Identity Services)

The sign-in and sign-up pages render **Google's official "Continue with Google" button**
(`src/features/auth/components/google-sign-in-button.tsx`, script
`https://accounts.google.com/gsi/client`). Its popup runs on our own origin, so Google's
consent screen shows `dashboard.levelup-ecosystem.com`, not the Supabase project URL.

- `google.accounts.id.initialize({ client_id, callback, nonce, ux_mode: 'popup',
  use_fedcm_for_prompt: true, itp_support: true, context })`, then `renderButton` (theme
  `outline` / `filled_black` with light/dark, `text: 'continue_with'`, `shape:
  'rectangular'`, width = the auth card, `locale` = dashboard language).
- **Nonce** (`src/features/auth/lib/google-identity.ts`): 32 random bytes
  (`crypto.getRandomValues`), Google gets the SHA-256 **hex** of the raw value, Supabase
  gets the raw value: `supabase.auth.signInWithIdToken({ provider: 'google', token:
  credential, nonce: raw })`. A new nonce is generated after each attempt.
- Success follows the same path as every method: `/auth/mfa` when a verified TOTP factor
  exists, otherwise `safeNext(next)` (the dashboard layout sends accounts without access to
  onboarding or the pending page); `lu_last_method = google`; `user_metadata.locale` saved
  if missing.
- **One Tap** is prompted on the sign-in page only (FedCM), not on sign-up.
- **Fallback** — if the GIS script cannot load (network, blocker, 8 s timeout), a
  LevelUp-styled "Continue with Google" button uses the old redirect flow
  (`signInWithOAuth`, `/auth/callback`), so nobody is stuck.
- Client id: `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, defaulting to the LevelUp web client
  `338931284223-7smftc9ekset4seun2er2tc3k5cb83p3.apps.googleusercontent.com`
  (`src/lib/auth/google.ts`; it is public, it appears in every Google popup).
- The button shows as soon as **Authentication → Providers → Google** is enabled in Supabase.

**Setup required (once):**

1. **Google Cloud → Google Auth Platform → Clients →** the web client above →
   **Authorized JavaScript origins**: `https://dashboard.levelup-ecosystem.com` and
   `http://localhost:3000` (development; add preview domains if Google sign-in should work
   there). Without the dashboard origin the GIS button cannot sign anyone in (Google
   answers `origin_mismatch` / "The given origin is not allowed"); only a script that
   fails to load switches to the redirect fallback, so this origin is required. Keep the existing redirect URI
   `https://rncuhmvykrmtxfzqpitc.supabase.co/auth/v1/callback` for the fallback flow.
2. **Supabase → Authentication → Providers → Google**: put this client id in
   **Client IDs** (authorized client ids; the web client first if there are several) and
   leave **Skip nonce check** off.
3. Optional: **Google Auth Platform → Branding** (app name, logo, authorized domain
   `levelup-ecosystem.com`) so the popup shows the LevelUp name and logo.
4. Content-Security-Policy (`next.config.ts`, see
   [deployment.md](./deployment.md#security-headers)) already allows
   `https://accounts.google.com/gsi/` in `script-src`, `style-src`, `frame-src` and
   `connect-src`, and `Cross-Origin-Opener-Policy: same-origin-allow-popups` keeps the
   GIS popup working.

### Passkeys

Supabase passkeys (WebAuthn, experimental, supabase-js ≥ 2.105). The browser client
(`src/lib/supabase/client.ts`) passes `auth: { experimental: { passkey: true } }`
through `createBrowserClient` (`@supabase/ssr` spreads `auth` into supabase-js; recent
supabase-js versions enable the API by default and ignore the flag).

- **Enable** — Supabase → Authentication → Sign In / Providers → *Passkeys* (relying
  party = the dashboard domain). `passkeys_enabled` then turns true in the settings.
- **Sign-in** — "Continue with a passkey" (icon: person with a key, `Icons.passkey` = Tabler `IconUserKey`) (`auth.signInWithPasskey()`, with the
  Turnstile token when CAPTCHA is on), hidden when the browser has no
  `window.PublicKeyCredential`. Success follows the password path: `/auth/mfa` when a
  verified TOTP factor exists, otherwise `safeNext(next)` (the dashboard layout sends
  accounts without access to onboarding). Cancelling the browser prompt is silent;
  `webauthn_credential_not_found` explains how to add one; `passkey_disabled` hides the
  button. The e-mail input uses `autocomplete='username webauthn'` (no conditional
  mediation).
- **Manage** — Profile → *Security* → *Passkeys* card
  (`src/features/profile/components/passkeys-card.tsx`, API in
  `src/features/profile/api`): list (`auth.passkey.list()`), add
  (`auth.registerPasskey()`), rename (`auth.passkey.update`), delete
  (`auth.passkey.delete`, confirmation dialog).
- Onboarding and the pending page no longer suggest passkeys or two-step verification
  (kept lean); the dashboard setup checklist covers two-step verification.

## Common passwords

Sign-up, reset-password and the profile password form refuse very common passwords
before calling Supabase (`src/lib/auth/password-check.ts`, form-level `onSubmitAsync`
validator): SHA-1 in the browser (`crypto.subtle`), only the first 5 hex characters go
to `https://api.pwnedpasswords.com/range/{prefix}` (`Add-Padding: true`), suffixes are
compared locally. A match shows "Ce mot de passe est trop courant. Choisissez-en un
autre." If the API fails or takes more than 3 s the password is accepted (fail open).
The Content-Security-Policy allows `api.pwnedpasswords.com`, the Supabase URL and
`challenges.cloudflare.com` in `connect-src` (see deployment.md).
