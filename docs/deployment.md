# Deployment

The dashboard deploys to Vercel out of the box, or anywhere Docker runs. `next.config.ts` switches to `output: 'standalone'` when `BUILD_STANDALONE=true` (the Dockerfiles set it), so Docker builds are optimized for self-hosting.

## Vercel (Recommended)

1. Connect the repository to Vercel
2. Add environment variables in the dashboard (see below)
3. Deploy
4. In Supabase (**Authentication → URL Configuration**), set the Site URL to `https://dashboard.levelup-ecosystem.com` and the redirect URLs listed in [auth.md](./auth.md#supabase-dashboard-setup) (each ending in `/**`, since the callback URL carries `?next=…`)

For other platforms, see the [Next.js deployment docs](https://nextjs.org/docs/app/getting-started/deploying).

## Environment Variables for Production

Ensure these are set in your deployment platform:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (optional: defaults to the LevelUp web client, see [auth.md](./auth.md#google-button-google-identity-services))
- All `NEXT_PUBLIC_*` variables for client-side access
- `SENTRY_*` variables if using error tracking

Sentry source maps are uploaded automatically in CI.

Only the publishable key is needed: the app never uses the Supabase secret / service-role key, and every query runs as the signed-in user through RLS.

## Analytics (Vercel)

`src/components/vercel-insights.tsx` (root layout) loads **Vercel Web Analytics**
(`@vercel/analytics`) and **Speed Insights** (`@vercel/speed-insights`). Both are
cookieless and store no personal data; URLs are reported **without query strings**
(`beforeSend`), so `next`, `code`, `token_hash` or e-mail addresses never leave the
browser. They report only on Vercel (scripts served from `/_vercel/*`).

Enable once: Vercel → project **leveldashs** → *Analytics* → **Enable**, and
*Speed Insights* → **Enable** (then redeploy). Nothing is sent until they are enabled.

## Security headers

Set for every route in `next.config.ts` (`securityHeaders()`):

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (2 years) |
| `Content-Security-Policy` (enforced) | `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests` (the last one in production only) |
| `Content-Security-Policy-Report-Only` | full allowlist: `default-src 'self'`; scripts from self + inline, Google Identity Services (`accounts.google.com/gsi/client`), Turnstile, Vercel Analytics (`va.vercel-scripts.com`, dev only; production uses `/_vercel/*`); `connect-src` Supabase (https + wss), GIS, Turnstile, Pwned Passwords; `frame-src` GIS + Turnstile; `img-src 'self' data: blob: https:` |
| `X-Frame-Options` | `DENY` (legacy twin of `frame-ancestors 'none'`: the dashboard is never framed) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` (required by Google's sign-in popup) |
| `Permissions-Policy` | camera, microphone, geolocation, payment, USB, serial, HID, Bluetooth, MIDI, motion sensors and Topics off; WebAuthn (passkeys) `self` only |

**Why report-only for the full CSP:** Next.js injects inline bootstrap scripts, so a
strict `script-src` would need a nonce pipeline (dynamic rendering of every page). The
allowlist is shipped as `Content-Security-Policy-Report-Only` first: violations show in
the browser console (DevTools) without breaking sign-in. After a week of production use
without violations (check sign-in with Google, Turnstile, passkeys, media library,
assistant), rename the header to `Content-Security-Policy` (merge both values).

**HTTPS:** Vercel redirects http → https at the edge. For other hosts the proxy
(`src/proxy.ts`) answers `308` to the https URL when `x-forwarded-proto` is `http`
(production only, never for localhost).

**HSTS preload:** the header is preload-ready, but the browsers' list
([hstspreload.org](https://hstspreload.org)) is per registrable domain: the apex
`levelup-ecosystem.com` (showcase) must also send `includeSubDomains; preload` before it
can be submitted, and every subdomain must then be https-only.

**CORS:** no route handler sends `Access-Control-Allow-*` headers, so browsers only allow
same-origin calls; the POST endpoints also refuse a foreign `Origin` (`/api/access/*`:
same host; `/api/assistant*`: same host or `https://dashboard.levelup-ecosystem.com`).
`/api/auth/email-hook` is server-to-server (Supabase) and authenticated by its signature.

## Docker

Two production-ready Dockerfiles are included: `Dockerfile` (Node.js) and `Dockerfile.bun` (Bun). `NEXT_PUBLIC_*` variables are inlined into the client bundle, so pass them as `--build-arg` at build time (and again via `-e` at run time for server code).

Build the image:

```bash
# Node.js
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://rncuhmvykrmtxfzqpitc.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx \
  -t levelup-dashboard .

# OR Bun
docker build -f Dockerfile.bun \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://rncuhmvykrmtxfzqpitc.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx \
  -t levelup-dashboard .
```

Run the container:

```bash
docker run -d -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=https://rncuhmvykrmtxfzqpitc.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx \
  --restart unless-stopped \
  --name levelup-dashboard \
  levelup-dashboard
```
