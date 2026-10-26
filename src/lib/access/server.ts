import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { inviteTokenFromNext, isInviteToken, type InvitationPreview } from './codes';

export type { InvitationPreview };

/** What the accept page may show about an invitation link (anyone holding the link). */
export async function getInvitationPreview(
  db: SupabaseClient,
  token: string | null | undefined
): Promise<InvitationPreview> {
  if (!isInviteToken(token)) return { status: 'invalid' };
  const { data, error } = await db.rpc('get_organization_invitation', { p_token: token });
  if (error || !data) return { status: 'invalid' };
  return data as InvitationPreview;
}

/**
 * Sign-in / sign-up started from an invitation link: the invited address, to
 * prefill and lock the e-mail field. Null for any other destination.
 */
export async function invitedEmailFor(next: string | undefined): Promise<string | null> {
  const token = inviteTokenFromNext(next);
  if (!token) return null;
  const preview = await getInvitationPreview(await createClient(), token);
  return preview.status === 'valid' ? preview.email : null;
}

/**
 * Pre-registered owner e-mail: links the signed-in account as the owner of its
 * website when the database finds a pending match (confirmed e-mail, exact
 * address, organization without owner). True when it just happened.
 */
export async function claimSiteOwnership(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.rpc('claim_site_ownership');
  if (error) return false;
  return (data as { status?: string } | null)?.status === 'claimed';
}
