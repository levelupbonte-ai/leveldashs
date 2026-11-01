import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, type ErrorCode } from '@/lib/errors';
import { PlanLimitError, parsePlanLimit, planLimitFromDb } from '@/lib/plan-limit';
import { toAppError } from '@/lib/supabase/rpc-error';
import type {
  Campaign,
  CampaignValues,
  ContactFilters,
  ContactPage,
  EmailBrand,
  EmailOverview,
  ExportedContact,
  ImportResult,
  SendProgress,
  SenderInput
} from './types';
import type { ImportRow } from '../lib/csv-import';

// Every read and write goes through the email_* functions as the signed-in user:
// the database checks the role (viewers read masked contacts, editors draft,
// owners and admins send, import and export) and writes the audit log.
// Sending itself goes through the dashboard routes (/api/email/...), which hold
// the e-mail provider key; the browser never sees it.

/** Database refusal codes (exception messages) → what the UI says. */
const BY_MESSAGE: Record<string, ErrorCode> = {
  sender_details_required: 'senderDetailsRequired',
  postal_address_required: 'senderDetailsRequired',
  invalid_reply_to: 'invalidEmail',
  invalid_color: 'invalidValues',
  not_draft: 'campaignNotDraft',
  not_scheduled: 'campaignNotDraft',
  no_recipients: 'noRecipients',
  sending_paused: 'sendingPaused',
  daily_cap_reached: 'dailyCapReached',
  consent_required: 'consentRequired',
  invalid_schedule: 'invalidSchedule',
  subject_required: 'subjectRequired',
  content_required: 'contentRequired',
  button_incomplete: 'buttonIncomplete',
  invalid_image: 'invalidImage',
  invalid_contacts: 'invalidValues',
  no_email: 'invalidEmail'
};

export function campaignError(
  error: { message: string; code?: string; details?: string | null } | null,
  fallback: ErrorCode = 'saveFailed'
): AppError {
  const limit = planLimitFromDb(error);
  if (limit) return new PlanLimitError(limit, { cause: error });
  const code = error ? BY_MESSAGE[error.message] : undefined;
  if (code) return new AppError(code, { cause: error });
  const mapped = toAppError(error);
  return mapped.code === 'generic' ? new AppError(fallback, { cause: error }) : mapped;
}

async function call<T>(
  query: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
  fallback: ErrorCode = 'saveFailed'
): Promise<T> {
  const { data, error } = await query;
  if (error) throw campaignError(error, fallback);
  return data as T;
}

export function getEmailOverview(db: SupabaseClient, websiteId: string) {
  return call<EmailOverview>(db.rpc('email_overview', { p_website_id: websiteId }), 'loadFailed');
}

export function listCampaigns(db: SupabaseClient, websiteId: string) {
  return call<Campaign[]>(
    db.rpc('email_campaigns_list', { p_website_id: websiteId }),
    'loadFailed'
  );
}

export function getCampaign(db: SupabaseClient, campaignId: string) {
  return call<Campaign>(db.rpc('email_campaign_get', { p_campaign_id: campaignId }), 'loadFailed');
}

export function listContacts(db: SupabaseClient, websiteId: string, filters: ContactFilters) {
  return call<ContactPage>(
    db.rpc('email_contacts_list', {
      p_website_id: websiteId,
      p_search: filters.search,
      p_status: filters.status,
      p_limit: filters.perPage,
      p_offset: (filters.page - 1) * filters.perPage
    }),
    'loadFailed'
  );
}

/** Editors and up: creates (campaignId null) or updates a draft. */
export function saveCampaign(
  db: SupabaseClient,
  websiteId: string,
  campaignId: string | null,
  values: CampaignValues
) {
  return call<Campaign>(
    db.rpc('email_campaign_save', {
      p_website_id: websiteId,
      p_campaign_id: campaignId,
      p_values: values
    })
  );
}

export function scheduleCampaign(db: SupabaseClient, campaignId: string, at: Date) {
  return call<{ scheduled_at: string; recipients: number }>(
    db.rpc('email_campaign_schedule', { p_campaign_id: campaignId, p_at: at.toISOString() })
  );
}

export function campaignToDraft(db: SupabaseClient, campaignId: string) {
  return call<null>(db.rpc('email_campaign_to_draft', { p_campaign_id: campaignId }));
}

export function saveSender(db: SupabaseClient, websiteId: string, input: SenderInput) {
  return call<EmailBrand>(
    db.rpc('email_save_sender', {
      p_website_id: websiteId,
      p_from_name: input.from_name || null,
      p_reply_to: input.reply_to || null,
      p_postal_address: input.postal_address,
      p_brand_color: input.brand_color || null
    })
  );
}

export function importContacts(
  db: SupabaseClient,
  websiteId: string,
  rows: ImportRow[],
  consentStatement: string
) {
  return call<ImportResult>(
    db.rpc('email_contacts_import', {
      p_website_id: websiteId,
      p_contacts: rows,
      p_consent_confirmed: true,
      p_consent_statement: consentStatement
    })
  );
}

export function exportContacts(db: SupabaseClient, websiteId: string) {
  return call<ExportedContact[]>(
    db.rpc('email_contacts_export', { p_website_id: websiteId }),
    'loadFailed'
  );
}

export function unsubscribeContact(db: SupabaseClient, contactId: string) {
  return call<null>(db.rpc('email_contact_unsubscribe', { p_contact_id: contactId }));
}

// ---------------------------------------------------------------- routes (provider key on the server)

const ROUTE_ERRORS: Record<string, ErrorCode> = {
  ...Object.fromEntries(Object.values(BY_MESSAGE).map((v) => [v, v])),
  forbidden: 'forbidden',
  rateLimited: 'rateLimited',
  mfaRequired: 'mfaRequired',
  emailSendFailed: 'emailSendFailed',
  emailNotConfigured: 'emailNotConfigured',
  planLimitReached: 'planLimitReached'
};

async function postRoute<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }).catch((cause) => {
    throw new AppError('network', { cause });
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; limit?: unknown };
  if (!res.ok) {
    const limit = parsePlanLimit(json.limit);
    if (limit) throw new PlanLimitError(limit);
    throw new AppError(ROUTE_ERRORS[json.error ?? ''] ?? 'emailSendFailed');
  }
  return json;
}

const campaignPath = (id: string, action: 'test' | 'send' | 'process') =>
  `/api/email/campaigns/${encodeURIComponent(id)}/${action}`;

/** Test e-mail to the signed-in user's own address. */
export function sendTestEmail(campaignId: string) {
  return postRoute<{ status: 'sent'; to: string }>(campaignPath(campaignId, 'test'));
}

/** Owners and admins: starts the campaign and sends the first batches. */
export function sendCampaign(campaignId: string) {
  return postRoute<SendProgress>(campaignPath(campaignId, 'send'));
}

/** Owners and admins: sends the next batches of a campaign being sent. */
export function processCampaign(campaignId: string) {
  return postRoute<SendProgress>(campaignPath(campaignId, 'process'));
}
