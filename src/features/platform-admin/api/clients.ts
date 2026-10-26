import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, isMfaError } from '@/lib/errors';
import { dbErrorCode, responseErrorCode } from '@/lib/access/db-errors';
import type {
  AccessRequest,
  AdminWebsiteRow,
  NewActivationCode,
  OrgRole,
  ReviewContext,
  ReviewDecision,
  ReviewOutcome,
  SiteAccess
} from './types';

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

/** LevelUp staff: every access request with the account and organization facts (pending first). */
export async function listAccessRequests(db: SupabaseClient): Promise<AccessRequest[]> {
  const { data, error } = await db.rpc('admin_list_access_requests');
  if (error) throw new AppError(dbErrorCode(error, 'loadFailed'), { cause: error });
  return (data ?? []) as AccessRequest[];
}

/** One request and the websites / organizations it could be connected to. */
export async function getReviewContext(db: SupabaseClient, userId: string): Promise<ReviewContext> {
  const { data, error } = await db.rpc('admin_access_review_context', { p_user_id: userId });
  if (error) throw new AppError(dbErrorCode(error, 'loadFailed'), { cause: error });
  return data as ReviewContext;
}

/**
 * Explicit decision (connect to a website, create a new client, decline). Goes
 * through the route handler, which e-mails the applicant.
 */
export async function decideAccessRequest(input: ReviewDecision): Promise<ReviewOutcome> {
  const res = await fetch('/api/access/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }).catch((cause) => {
    throw new AppError('network', { cause });
  });
  const body = (await res.json().catch(() => ({}))) as Partial<ReviewOutcome> & { error?: string };
  if (!res.ok) throw new AppError(responseErrorCode(body.error));
  return body as ReviewOutcome;
}

// ---------------------------------------------------------------- site access

export async function getSiteAccess(db: SupabaseClient, websiteId: string): Promise<SiteAccess> {
  const { data, error } = await db.rpc('admin_get_site_access', { p_website_id: websiteId });
  if (error) throw new AppError(dbErrorCode(error, 'loadFailed'), { cause: error });
  return data as SiteAccess;
}

/** Pending owner e-mail of a website ('' clears it). */
export async function setSiteOwnerEmail(db: SupabaseClient, websiteId: string, email: string) {
  const { error } = await db.rpc('admin_set_site_owner_email', {
    p_website_id: websiteId,
    p_email: email || null
  });
  if (error) throw new AppError(dbErrorCode(error, 'saveFailed'), { cause: error });
}

/** A new one-time activation code; the only time the code itself is returned. */
export async function createActivationCode(
  db: SupabaseClient,
  input: { websiteId: string; role: OrgRole; email?: string }
): Promise<NewActivationCode> {
  const { data, error } = await db.rpc('admin_create_activation_code', {
    p_website_id: input.websiteId,
    p_role: input.role,
    p_email: input.email || null
  });
  if (error) throw new AppError(dbErrorCode(error, 'createFailed'), { cause: error });
  return data as NewActivationCode;
}

export async function revokeActivationCode(db: SupabaseClient, codeId: string) {
  const { error } = await db.rpc('admin_revoke_activation_code', { p_code_id: codeId });
  if (error) throw new AppError(dbErrorCode(error, 'saveFailed'), { cause: error });
}
