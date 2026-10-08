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
| `/auth/sign-in` | Email + password, "Continuer avec Google" (Google-branded button) and "Se connecter avec une passkey" when enabled in Supabase, password reset link |
| `/auth/sign-up` | Email + password + full name (stored in `user_metadata.full_name`), Google when enabled |
| `/auth/verified` | Landing page of the sign-up confirmation link: "Félicitations, votre adresse e-mail est vérifiée", go back to the first device or "Continuer ici" (`next`, default `/auth/onboarding`) |
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
- Sign-up confirmation → always `/auth/verified?next=…` (the hook wraps `next`).
- Magic links are no longer offered on the sign-in page (the hook still formats them if
  Supabase sends one).

Setup: Supabase → Authentication → Hooks → Send Email → HTTPS
`https://dashboard.levelup-ecosystem.com/api/auth/email-hook`, generate the
secret, then set on Vercel (leveldashs): `SEND_EMAIL_HOOK_SECRET` (the
`v1,whsec_…` value) and `RESEND_API_KEY`. Optional `AUTH_EMAIL_FROM`
(default `LevelUp Ecosystem <account@levelup-ecosystem.com>`, a verified Resend domain).

## Two-factor authentication (TOTP)

Supabase native MFA, authenticator apps only (Google Authenticator, 1Password, …).

- **Enroll** — Profile → *Sécurité* (`src/features/profile/components/security-section.tsx`,
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
- **Required for managers** — platform admins and organization owners/admins without a
  verified factor see a persistent banner (`MfaRequiredBanner`) linking to
  `/dashboard/profile#securite` (`session.mfa.required` / `session.mfa.enabled`).
- **Sessions** — *Déconnecter tous mes appareils* calls `auth.signOut({ scope: 'global' })`
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

## Dashboard access on approval

Creating an account is open (LevelStudio stays available), but `/dashboard` only
opens to members of an organization or LevelUp staff (`src/app/dashboard/layout.tsx`).

- **Invited people** join their organization automatically when they confirm
  their e-mail (`private.accept_invitations`): no approval needed.
- **Everyone else** lands on `/auth/onboarding`: profile (name, photo), then an
  access request (`submit_access_request`, table `access_requests`). The team
  gets an e-mail; requests show on `/dashboard/exclusive` where staff approve
  (`review_access_request`: creates the client's organization, owner role) or
  reject. The applicant is e-mailed either way (`/api/access/decision`).
- `create_organization` is limited to staff and existing members, so approval
  cannot be skipped.

Sign-up runs in steps (account → e-mail check → profile → approval); forgotten
passwords have their own confirmation screen with a resend
cooldown (`/auth/forgot-password`). Avatars and organization logos are uploaded
to the public `brand` bucket (`avatars/<user>/`, `orgs/<org>/`, images only, 2 MB).

## Cross-device e-mail verification

People often sign up on a computer and open the confirmation e-mail on their phone.

1. Sign-up keeps the e-mail and password **in React state only** (never storage) and
   shows `SignupEmailSent` (`src/features/auth/components/signup-email-sent.tsx`).
2. `useEmailVerificationWatch` (`src/features/auth/hooks/`) retries
   `signInWithPassword` every **10 s** (30 calls / 5 min = the default per-IP sign-in
   limit; a 429 doubles the delay up to 60 s). Supabase answers `email_not_confirmed`
   until the link is clicked, then signs in on this device and the tab goes to
   `/auth/onboarding` by itself. It pauses while the tab is hidden (checks again on
   `visibilitychange`), stops after 20 minutes ("Vérifier maintenant" restarts it), and
   also listens to `onAuthStateChange` / `getSession` for a link opened in the same browser.
3. The link (`/auth/callback?token_hash=…`) creates a session where it is opened and
   lands on `/auth/verified`: congratulations, "go back to the device where you started",
   and a "Continuer ici" button.

Google sign-ups need no e-mail check.

## Sign-in methods (live Supabase settings)

There is no environment flag: `getAuthMethods()` (`src/lib/auth/auth-methods.ts`,
server-only) reads `GET {NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings` with the
publishable key (`next: { revalidate: 300 }`, 3 s timeout) and returns
`{ google: external.google, passkey: passkeys_enabled }`. The sign-in, sign-up,
onboarding and profile pages pass these flags down. Any error hides the buttons
(fail closed). Turning a provider on or off in the Supabase dashboard shows or
hides the buttons within five minutes, without a redeploy.

Layout of the sign-in form: Google and passkey buttons stacked at the top, then the
"ou par e-mail" divider, then e-mail + password.

### Google button

"Continuer avec Google" (white button, official multicolor G — `Icons.googleColor` —
per Google's sign-in branding guidelines) calls
`signInWithOAuth({ provider: 'google' })` with `redirectTo` = `/auth/callback?next=…`;
the callback sends users with an authenticator app to `/auth/mfa` first. It shows as
soon as **Authentication → Providers → Google** is enabled in Supabase.

### Passkeys

Supabase passkeys (WebAuthn, experimental, supabase-js ≥ 2.105). The browser client
(`src/lib/supabase/client.ts`) passes `auth: { experimental: { passkey: true } }`
through `createBrowserClient` (`@supabase/ssr` spreads `auth` into supabase-js; recent
supabase-js versions enable the API by default and ignore the flag).

- **Enable** — Supabase → Authentication → Sign In / Providers → *Passkeys* (relying
  party = the dashboard domain). `passkeys_enabled` then turns true in the settings.
- **Sign-in** — "Se connecter avec une passkey" (`auth.signInWithPasskey()`, with the
  Turnstile token when CAPTCHA is on), hidden when the browser has no
  `window.PublicKeyCredential`. Success follows the password path: `/auth/mfa` when a
  verified TOTP factor exists, otherwise `safeNext(next)` (the dashboard layout sends
  accounts without access to onboarding). Cancelling the browser prompt is silent;
  `webauthn_credential_not_found` explains how to add one; `passkey_disabled` hides the
  button. The e-mail input uses `autocomplete='username webauthn'` (no conditional
  mediation).
- **Manage** — Profile → *Sécurité* → *Passkeys* card
  (`src/features/profile/components/passkeys-card.tsx`, API in
  `src/features/profile/api`): list (`auth.passkey.list()`), add
  (`auth.registerPasskey()`), rename (`auth.passkey.update`), delete
  (`auth.passkey.delete`, confirmation dialog).
- **Onboarding** suggests adding one (link to Profil → Sécurité) when enabled.

## Common passwords

Sign-up, reset-password and the profile password form refuse very common passwords
before calling Supabase (`src/lib/auth/password-check.ts`, form-level `onSubmitAsync`
validator): SHA-1 in the browser (`crypto.subtle`), only the first 5 hex characters go
to `https://api.pwnedpasswords.com/range/{prefix}` (`Add-Padding: true`), suffixes are
compared locally. A match shows "Ce mot de passe est trop courant. Choisissez-en un
autre." If the API fails or takes more than 3 s the password is accepted (fail open).
There is no Content-Security-Policy header today; if one is added, `connect-src` must
allow `api.pwnedpasswords.com`, the Supabase URL and `challenges.cloudflare.com`.
