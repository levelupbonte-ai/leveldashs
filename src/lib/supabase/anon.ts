import 'server-only';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, assertSupabaseEnv } from './env';

/**
 * Server client WITHOUT a user session (role `anon`, publishable key). Only for
 * server-to-database calls that authenticate themselves another way inside the
 * function, e.g. the Stripe webhook with the billing webhook key
 * (public.billing_ingest_stripe_event). Never reads the request cookies.
 */
export function createAnonClient(): SupabaseClient {
  assertSupabaseEnv();
  return createSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}
