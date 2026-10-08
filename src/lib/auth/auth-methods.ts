import 'server-only';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';

/** Sign-in methods offered next to e-mail + password. */
export interface AuthMethods {
  google: boolean;
  passkey: boolean;
}

const NONE: AuthMethods = { google: false, passkey: false };

/**
 * Reads the live Supabase Auth settings (public endpoint, publishable key) so the
 * Google and passkey buttons appear as soon as they are enabled in the Supabase
 * dashboard. Cached 5 minutes; any error hides both buttons (fail closed).
 */
export async function getAuthMethods(): Promise<AuthMethods> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return NONE;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return NONE;
    const settings = (await res.json()) as {
      external?: { google?: unknown };
      passkeys_enabled?: unknown;
    };
    return {
      google: settings.external?.google === true,
      passkey: settings.passkeys_enabled === true
    };
  } catch {
    return NONE;
  }
}
