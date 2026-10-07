import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgRole } from '@/lib/auth/types';
import type { AdminWebsiteRow, OrgMember } from './types';

export async function listMembers(
  db: SupabaseClient,
  organizationId: string
): Promise<OrgMember[]> {
  const { data: members, error } = await db
    .from('organization_members')
    .select('user_id, role, created_at')
    .eq('organization_id', organizationId)
    .order('created_at');
  if (error) throw new Error('Impossible de charger les membres.');
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
): Promise<'added' | 'updated' | 'not_found'> {
  const { data, error } = await db.rpc('add_organization_member', {
    p_organization_id: organizationId,
    p_email: email,
    p_role: role
  });
  if (error) throw new Error(error.code === 'PT403' ? 'Droits insuffisants.' : 'Ajout impossible.');
  return data as 'added' | 'updated' | 'not_found';
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
    throw new Error(
      error?.message.includes('owner')
        ? 'Une organisation doit garder au moins un propriétaire.'
        : 'Modification impossible (droits insuffisants).'
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
    throw new Error(
      error?.message.includes('owner')
        ? 'Une organisation doit garder au moins un propriétaire.'
        : 'Suppression impossible (droits insuffisants).'
    );
  }
}

export async function createOrganization(db: SupabaseClient, name: string, slug: string) {
  const { data, error } = await db.rpc('create_organization', { p_name: name, p_slug: slug });
  if (error) {
    throw new Error(
      error.code === '23505'
        ? 'Cet identifiant est déjà pris.'
        : error.message.includes('limit')
          ? 'Nombre maximum d’organisations atteint.'
          : 'Création impossible.'
    );
  }
  return data as { id: string };
}

/** LevelUp staff: every website with its organization (RLS: platform admins only). */
export async function listAllWebsites(db: SupabaseClient): Promise<AdminWebsiteRow[]> {
  const { data, error } = await db
    .from('websites')
    .select(
      'id, name, primary_domain, status, organization_id, organizations (name), website_features (feature_key, enabled)'
    )
    .order('name');
  if (error) throw new Error('Impossible de charger les sites.');
  return (data ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    primaryDomain: w.primary_domain,
    status: w.status,
    organizationId: w.organization_id,
    organizationName: (w.organizations as unknown as { name: string } | null)?.name ?? '—',
    features: ((w.website_features ?? []) as { feature_key: string; enabled: boolean }[])
      .filter((f) => f.enabled)
      .map((f) => f.feature_key)
  }));
}
