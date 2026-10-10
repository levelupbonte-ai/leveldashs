# Deployment

The dashboard deploys to Vercel out of the box, or anywhere Docker runs. `next.config.ts` switches to `output: 'standalone'` when `BUILD_STANDALONE=true` (the Dockerfiles set it), so Docker builds are optimized for self-hosting.

## Vercel (Recommended)

1. Connect the repository to Vercel
2. Add environment variables in the dashboard (see below)
3. Deploy
4. In Supabase (**Authentication → URL Configuration**), set the Site URL to the production domain and add `https://<domain>/auth/callback` to the redirect URLs (see [auth.md](./auth.md))

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
