import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import { authCookieOptions } from './cookie-domain';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, assertSupabaseEnv } from './env';

// Server client bound to the request cookies: acts as the signed-in user,
// so Row Level Security applies exactly as in the browser.
export async function createClient(): Promise<SupabaseClient> {
  assertSupabaseEnv();
  const cookieStore = await cookies();
  const host = (await headers()).get('host');
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: authCookieOptions(host),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      }
    }
  });
}
