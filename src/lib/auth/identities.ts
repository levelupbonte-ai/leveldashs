import type { User } from '@supabase/supabase-js';

type IdentityUser = Pick<User, 'identities' | 'app_metadata'> | null | undefined;

/**
 * True when the account already signs in with Google (a linked `google`
 * identity, or `google` in `app_metadata.providers`). Such users never need a
 * "Continuer avec Google" button again.
 */
export function hasGoogleIdentity(user: IdentityUser): boolean {
  if (!user) return false;
  if (user.identities?.some((identity) => identity.provider === 'google')) return true;
  const providers = (user.app_metadata as { providers?: unknown } | undefined)?.providers;
  return Array.isArray(providers) && providers.includes('google');
}
