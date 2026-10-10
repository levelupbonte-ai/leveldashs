import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgRole } from '@/lib/auth/types';
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

export async function addMember(
  db: SupabaseClient,
  organizationId: string,
  email: string,
  role: OrgRole
): Promise<'added' | 'updated' | 'invited'> {
  const { data, error } = await db.rpc('add_organization_member', {
    p_organization_id: organizationId,
    p_email: email,
    p_role: role
  });
  if (error) {
    throw new AppError(
      isMfaError(error) ? 'mfaRequired' : error.code === 'PT403' ? 'forbidden' : 'addMemberFailed',
      { cause: error }
    );
  }
  return data as 'added' | 'updated' | 'invited';
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

export interface PendingInvitation {
  id: string;
  email: string;
  role: OrgRole;
  created_at: string;
  expires_at: string;
}

export async function listInvitations(db: SupabaseClient, organizationId: string) {
  const { data, error } = await db
    .from('organization_invitations')
    .select('id, email, role, created_at, expires_at')
    .eq('organization_id', organizationId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []) as PendingInvitation[];
}

export async function cancelInvitation(db: SupabaseClient, id: string) {
  const { error, count } = await db
    .from('organization_invitations')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error || !count) {
    throw new AppError(isMfaError(error) ? 'mfaRequired' : 'cancelInvitationFailed', {
      cause: error
    });
  }
}
