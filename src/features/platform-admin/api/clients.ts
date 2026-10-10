import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, isMfaError } from '@/lib/errors';
import type { AdminWebsiteRow } from './types';

// LevelUp staff only (RLS: platform admins). Kept out of the client features so
// regular accounts never load this code.

/** LevelUp staff: every website with its organization (RLS: platform admins only). */
export async function listAllWebsites(db: SupabaseClient): Promise<AdminWebsiteRow[]> {
  const { data, error } = await db
    .from('websites')
    .select(
      'id, name, primary_domain, status, organization_id, organizations (name), website_features (feature_key, enabled)'
    )
    .order('name');
  if (error) throw new AppError('loadFailed', { cause: error });
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
  if (error) throw new AppError('loadFailed', { cause: error });
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
    throw new AppError(
      error.code === '23505'
        ? 'domainTaken'
        : error.code === '23514'
          ? 'invalidDomain'
          : isMfaError(error)
            ? 'mfaRequired'
            : error.code === 'PT403'
              ? 'forbidden'
              : 'createFailed',
      { cause: error }
    );
  }
  return data as {
    organization_id: string;
    website_id: string;
    owner: string | null;
  };
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
  if (error) throw new AppError('loadFailed', { cause: error });
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
    throw new AppError(
      body.error === 'mfa' ? 'mfaRequired' : body.error === 'forbidden' ? 'forbidden' : 'generic'
    );
  }
}
