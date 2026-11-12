import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import { assertFileSignature } from '@/lib/file-signature';
import { rpc } from '@/lib/supabase/rpc-error';
import {
  PORTAL_DOCUMENT_MAX_BYTES,
  PORTAL_DOCUMENT_TYPES,
  type PortalItemInput,
  type PortalMessage,
  type PortalOverview,
  type PortalPlanInput,
  type PortalSettings
} from './types';

// Client portal (feature `client_portal`): every read and write goes through the
// portal_admin_* functions, which check editor+ on the website's organization and
// write site_audit_log. Customers never use the dashboard; they sign in on the
// client's website, whose server sends every e-mail (see docs/database.md).

export function getPortalOverview(db: SupabaseClient, websiteId: string) {
  return rpc<PortalOverview>(db.rpc('portal_admin_overview', { p_website_id: websiteId }));
}

export function getPortalSettings(db: SupabaseClient, websiteId: string) {
  return rpc<PortalSettings>(db.rpc('portal_admin_settings', { p_website_id: websiteId }));
}

/** Free offer (length and level) and the members-only contact numbers. Admins only. */
export function savePortalSettings(
  db: SupabaseClient,
  websiteId: string,
  input: { trialDays: number; trialLevel: number; contact: PortalSettings['contact'] }
) {
  return rpc<null>(
    db.rpc('portal_admin_save_settings', {
      p_website_id: websiteId,
      p_trial_days: input.trialDays,
      p_trial_level: input.trialLevel,
      p_contact: input.contact
    })
  );
}

/** One of the three monthly plans. Members already subscribed keep their price. Admins only. */
export function savePortalPlan(db: SupabaseClient, websiteId: string, plan: PortalPlanInput) {
  return rpc<string>(
    db.rpc('portal_admin_save_plan', {
      p_website_id: websiteId,
      p_level: plan.level,
      p_name: plan.name,
      p_description: plan.description || null,
      p_features: plan.features,
      p_amount: plan.amount,
      p_currency: plan.currency,
      p_active: plan.active
    })
  );
}

/** Moves the end of one member's free offer (or ends it now). */
export function setPortalTrial(db: SupabaseClient, customerId: string, endsAt: Date) {
  return rpc<null>(
    db.rpc('portal_admin_set_trial', { p_customer_id: customerId, p_ends_at: endsAt.toISOString() })
  );
}

export function invitePortalCustomer(
  db: SupabaseClient,
  websiteId: string,
  input: { email: string; name: string; offerId: string; locale: 'en' | 'fr' }
) {
  return rpc<{ ok: true; id: string; created: boolean }>(
    db.rpc('portal_admin_invite', {
      p_website_id: websiteId,
      p_email: input.email,
      p_name: input.name || null,
      p_offer_id: input.offerId || null,
      p_locale: input.locale
    })
  );
}

export function setPortalCustomerStatus(
  db: SupabaseClient,
  customerId: string,
  status: 'active' | 'revoked'
) {
  return rpc<{ ok: true }>(
    db.rpc('portal_admin_set_customer_status', { p_customer_id: customerId, p_status: status })
  );
}

export function publishPortalItem(
  db: SupabaseClient,
  websiteId: string,
  item: PortalItemInput,
  notify: boolean
) {
  return rpc<{ ok: true; id: string; notified: number }>(
    db.rpc('portal_admin_publish', { p_website_id: websiteId, p_item: item, p_notify: notify })
  );
}

export function archivePortalItem(db: SupabaseClient, itemId: string) {
  return rpc<{ ok: true }>(db.rpc('portal_admin_archive_item', { p_item_id: itemId }));
}

export function getPortalThread(db: SupabaseClient, customerId: string) {
  return rpc<PortalMessage[]>(db.rpc('portal_admin_thread', { p_customer_id: customerId }));
}

export function replyToPortalCustomer(db: SupabaseClient, customerId: string, body: string) {
  return rpc<{ ok: true; id: string }>(
    db.rpc('portal_admin_reply', { p_customer_id: customerId, p_body: body })
  );
}

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

/**
 * Uploads a document to the private `portal-documents` bucket as the signed-in
 * editor (Storage policy checks the role and the path) and returns its path.
 * The content must really be a PDF / JPEG / PNG / WebP (first bytes checked).
 */
export async function uploadPortalDocument(
  db: SupabaseClient,
  scope: { organizationId: string; websiteId: string },
  file: File
) {
  if (file.size > PORTAL_DOCUMENT_MAX_BYTES) throw new AppError('mediaTooLarge');
  const type = await assertFileSignature(file, PORTAL_DOCUMENT_TYPES, 'mediaFormat');
  const path = `org/${scope.organizationId}/site/${scope.websiteId}/${crypto.randomUUID()}.${EXTENSIONS[type]}`;
  const { error } = await db.storage
    .from('portal-documents')
    .upload(path, file, { contentType: type, upsert: false });
  if (error) throw new AppError('uploadFailed', { cause: error });
  return path;
}

/** Short-lived link for the owner to check a document (60 seconds). */
export async function portalDocumentUrl(db: SupabaseClient, path: string) {
  const { data, error } = await db.storage.from('portal-documents').createSignedUrl(path, 60);
  if (error || !data) throw new AppError('loadFailed', { cause: error });
  return data.signedUrl;
}

/**
 * Asks the client website to send the queued e-mails now (dashboard route,
 * signed server-to-server call). Best effort: the website also sends them on
 * its own schedule.
 */
export async function nudgePortalEmails(websiteId: string): Promise<'sent' | 'skipped'> {
  try {
    const res = await fetch('/api/portal/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteId })
    });
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    return res.ok && body?.status === 'sent' ? 'sent' : 'skipped';
  } catch {
    return 'skipped';
  }
}
