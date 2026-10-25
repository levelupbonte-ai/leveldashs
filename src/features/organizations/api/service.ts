import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgRole } from '@/lib/auth/types';
import { dbErrorCode, responseErrorCode } from '@/lib/access/db-errors';
import { AppError, isMfaError } from '@/lib/errors';
import type { OrgMember } from './types';

export async function listMembers(
  db: SupabaseClient,
  organizationId: string
): Promise<OrgMember[]> {
  const { data: members, error } = await db
    .from('organization_members')
    .select('user_id, role, created_at')
    .eq('organization_id', organizationId)
    .order('created_at');
  if (error) throw new AppError('loadMembers', { cause: error });
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await db.from('profiles').select('id, full_name, email, avatar_url').in('id', ids)
    : { data: [] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return (members ?? []).map((m) => {
    const p = byId.get(m.user_id);
    return {
      userId: m.user_id,
      role: m.role as OrgRole,
      fullName: p?.full_name ?? null,
      email: p?.email ?? null,
      avatarUrl: p?.avatar_url ?? null,
      createdAt: m.created_at
    };
  });
}

export async function updateMemberRole(
  db: SupabaseClient,
  organizationId: string,
  userId: string,
  role: OrgRole
) {
  const { error, count } = await db
    .from('organization_members')
    .update({ role }, { count: 'exact' })
    .eq('organization_id', organizationId)
    .eq('user_id', userId);
  if (error || !count) {
    throw new AppError(
      isMfaError(error)
        ? 'mfaRequired'
        : error?.message.includes('owner')
          ? 'keepOneOwner'
          : 'updateRoleFailed',
      { cause: error }
    );
  }
}

export async function removeMember(db: SupabaseClient, organizationId: string, userId: string) {
  const { error, count } = await db
    .from('organization_members')
    .delete({ count: 'exact' })
    .eq('organization_id', organizationId)
    .eq('user_id', userId);
  if (error || !count) {
    throw new AppError(
      isMfaError(error)
        ? 'mfaRequired'
        : error?.message.includes('owner')
          ? 'keepOneOwner'
          : 'removeMemberFailed',
      { cause: error }
    );
  }
}

export async function createOrganization(db: SupabaseClient, name: string, slug: string) {
  const { data, error } = await db.rpc('create_organization', {
    p_name: name,
    p_slug: slug
  });
  if (error) {
    throw new AppError(
      error.code === '23505'
        ? 'slugTaken'
        : error.message.includes('limit')
          ? 'orgLimit'
          : 'createOrgFailed',
      { cause: error }
    );
  }
  return data as { id: string };
}

export interface Invitation {
  id: string;
  email: string;
  role: OrgRole;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  email_status: 'pending' | 'sent' | 'failed';
  last_sent_at: string | null;
  send_count: number;
}

/** Pending invitations and the ones accepted in the last 30 days (never revoked ones). */
export async function listInvitations(db: SupabaseClient, organizationId: string) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data, error } = await db
    .from('organization_invitations')
    .select(
      'id, email, role, created_at, expires_at, accepted_at, revoked_at, email_status, last_sent_at, send_count'
    )
    .eq('organization_id', organizationId)
    .is('revoked_at', null)
    .or(`accepted_at.is.null,accepted_at.gte.${since}`)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new AppError('loadFailed', { cause: error });
  return (data ?? []) as Invitation[];
}

export interface InviteResult {
  status: 'sent' | 'email_failed';
  invitationId: string;
}

async function postInvitation(path: string, body: unknown): Promise<InviteResult> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch((cause) => {
    throw new AppError('network', { cause });
  });
  const json = (await res.json().catch(() => ({}))) as Partial<InviteResult> & { error?: string };
  if (!res.ok || !json.invitationId) throw new AppError(responseErrorCode(json.error));
  return json as InviteResult;
}

/**
 * Invites someone by e-mail: the server creates the invitation (single-use
 * link) and e-mails it. `email_failed` means the invitation exists but Resend
 * did not accept the e-mail: offer a retry, never say it was sent.
 */
export function inviteMember(organizationId: string, email: string, role: OrgRole) {
  return postInvitation('/api/team/invitations', { organizationId, email, role });
}

/** New link e-mailed again (the previous link stops working). */
export function resendInvitation(invitationId: string) {
  return postInvitation('/api/team/invitations/resend', { invitationId });
}

/** Revoked (kept for the record); the link stops working. */
export async function revokeInvitation(db: SupabaseClient, invitationId: string) {
  const { error } = await db.rpc('revoke_organization_invitation', {
    p_invitation_id: invitationId
  });
  if (error) throw new AppError(dbErrorCode(error, 'cancelInvitationFailed'), { cause: error });
}
