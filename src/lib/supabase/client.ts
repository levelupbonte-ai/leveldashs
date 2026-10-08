'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authCookieOptions } from './cookie-domain';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, assertSupabaseEnv } from './env';

let client: SupabaseClient | undefined;

// Browser client: acts as the signed-in user, so Row Level Security applies.
export function createClient(): SupabaseClient {
  if (client) return client;
  assertSupabaseEnv();
  client = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: authCookieOptions(window.location.hostname),
    // Passkeys (WebAuthn): @supabase/ssr spreads `auth` into supabase-js. Recent
    // supabase-js releases enable the passkey API by default and ignore this flag;
    // it is kept as an explicit opt-in for older versions.
    auth: { experimental: { passkey: true } }
  });
  return client;
}
