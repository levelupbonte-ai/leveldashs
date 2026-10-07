'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, assertSupabaseEnv } from './env';

let client: SupabaseClient | undefined;

// Browser client: acts as the signed-in user, so Row Level Security applies.
export function createClient(): SupabaseClient {
  if (client) return client;
  assertSupabaseEnv();
  client = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return client;
}
