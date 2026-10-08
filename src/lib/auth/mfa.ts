import type { SupabaseClient, User } from '@supabase/supabase-js';

/** Path of the second-factor (TOTP) challenge page. */
export const MFA_CHALLENGE_PATH = '/auth/mfa';

/** True when the user has at least one verified MFA factor (TOTP). */
export function hasVerifiedFactor(user: Pick<User, 'factors'> | null | undefined): boolean {
  return !!user?.factors?.some((f) => f.status === 'verified');
}

/**
 * True when the session is aal1 but the user has a verified factor, i.e. the
 * second factor still has to be checked before the dashboard (or another
 * LevelUp app) is reached. Pass the user returned by `auth.getUser()` (validated
 * with Supabase) so a stale cookie cannot hide a factor.
 */
export async function needsMfaChallenge(supabase: SupabaseClient, user?: User | null) {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  const nextLevel = user ? (hasVerifiedFactor(user) ? 'aal2' : data.nextLevel) : data.nextLevel;
  return data.currentLevel !== 'aal2' && nextLevel === 'aal2';
}

/** `/auth/mfa?next=…` keeping the post-login destination. */
export function mfaChallengeUrl(next: string): string {
  return `${MFA_CHALLENGE_PATH}?next=${encodeURIComponent(next)}`;
}
