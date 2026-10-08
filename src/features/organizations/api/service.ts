import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgRole } from '@/lib/auth/types';
import type { AdminWebsiteRow, OrgMember } from './types';

// Raised by the database (private.assert_mfa) when the session is not aal2.
const MFA_REQUIRED_MESSAGE =
  'Confirmez d’abord votre code de vérification en deux étapes (reconnectez-vous).';

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
): Promise<'added' | 'updated' | 'invited'> {
  const { data, error } = await db.rpc('add_organization_member', {
    p_organization_id: organizationId,
    p_email: email,
    p_role: role
  });
  if (error) {
    throw new Error(
      error.message.includes('aal2')
        ? MFA_REQUIRED_MESSAGE
        : error.code === 'PT403'
          ? 'Droits insuffisants.'
          : 'Ajout impossible.'
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
  const { data, error } = await db.rpc('create_organization', {
    p_name: name,
    p_slug: slug
  });
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

export async function listFeatures(db: SupabaseClient) {
  const { data, error } = await db
    .from('features')
    .select('key, name, description')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw new Error('Impossible de charger les fonctions.');
  return (data ?? []) as {
    key: string;
    name: string;
    description: string | null;
  }[];
}

export interface NewClientInput {
  organizationName: string;
  websiteName: string;
  primaryDomain?: string;
  siteType?: string;
  features: string[];
  ownerEmail?: string;
}

/** LevelUp staff: creates the organization, website, features and owner invitation. */
export async function createClientSite(db: SupabaseClient, input: NewClientInput) {
  const { data, error } = await db.rpc('admin_create_client_site', {
    p_website_name: input.websiteName,
    p_organization_name: input.organizationName,
    p_primary_domain: input.primaryDomain || null,
    p_site_type: input.siteType || null,
    p_features: input.features,
    p_owner_email: input.ownerEmail || null
  });
  if (error) {
    throw new Error(
      error.code === '23505'
        ? 'Ce domaine est déjà utilisé par un autre site.'
        : error.code === '23514'
          ? 'Domaine ou type de site invalide.'
          : error.message.includes('aal2')
            ? MFA_REQUIRED_MESSAGE
            : error.code === 'PT403'
              ? 'Réservé à l’équipe LevelUp.'
              : 'Création impossible.'
    );
  }
  return data as {
    organization_id: string;
    website_id: string;
    owner: string | null;
  };
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
  if (error || !count) throw new Error('Annulation impossible (droits insuffisants).');
}

export interface AccessRequest {
  user_id: string;
  business_name: string;
  website: string | null;
  phone: string | null;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  email: string | null;
  full_name: string | null;
}

/** LevelUp staff: dashboard access requests, pending first (RLS: platform admins only). */
export async function listAccessRequests(db: SupabaseClient): Promise<AccessRequest[]> {
  const { data, error } = await db
    .from('access_requests')
    .select('user_id, business_name, website, phone, message, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error('Impossible de charger les demandes.');
  const ids = (data ?? []).map((r) => r.user_id);
  const { data: profiles } = ids.length
    ? await db.from('profiles').select('id, email, full_name').in('id', ids)
    : { data: [] as { id: string; email: string | null; full_name: string | null }[] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return (data ?? [])
    .map((r) => ({
      ...(r as Omit<AccessRequest, 'email' | 'full_name'>),
      email: byId.get(r.user_id)?.email ?? null,
      full_name: byId.get(r.user_id)?.full_name ?? null
    }))
    .toSorted((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
}

/** Approve (new organization named after the business, or an existing one) or reject; e-mails the applicant. */
export async function decideAccessRequest(input: {
  userId: string;
  approve: boolean;
  organizationId?: string;
}) {
  const res = await fetch('/api/access/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(
      body.error === 'mfa'
        ? MFA_REQUIRED_MESSAGE
        : body.error === 'forbidden'
          ? 'Réservé à l’équipe LevelUp.'
          : 'Décision impossible.'
    );
  }
}
