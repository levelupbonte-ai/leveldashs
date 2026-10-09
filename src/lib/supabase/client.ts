'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authCookieOptions } from './cookie-domain';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, assertSupabaseEnv } from './env';

let client: SupabaseClient | undefined;

// Browser client: acts as the signed-in user, so Row Level Security applies.
// Client components may call this while rendering, which also runs during SSR:
// there is no `window` then, so a throwaway client (no session) is returned and
// only the browser keeps the singleton.
export function createClient(): SupabaseClient {
  if (client) return client;
  assertSupabaseEnv();
  const isBrowser = typeof window !== 'undefined';
  const instance = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: isBrowser ? authCookieOptions(window.location.hostname) : undefined,
    // Passkeys (WebAuthn): @supabase/ssr spreads `auth` into supabase-js. Recent
    // supabase-js releases enable the passkey API by default and ignore this flag;
    // it is kept as an explicit opt-in for older versions.
    auth: { experimental: { passkey: true } }
  });
  if (isBrowser) client = instance;
  return instance;
}
