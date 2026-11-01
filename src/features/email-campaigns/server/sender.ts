import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTranslatorFor } from '@/i18n/messages';
import { DASHBOARD_URL } from '@/lib/email/access-emails';
import { SUPABASE_URL } from '@/lib/supabase/env';
import { cleanHeader, isEmail } from '@/lib/validation/sanitize';
import type { EmailBrand } from '../api/types';
import {
  fromHeader,
  mediaPublicUrl,
  renderCampaign,
  unsubscribeHeaders,
  unsubscribeUrls,
  type CampaignBrand,
  type CampaignContent,
  type CampaignTemplate,
  type FooterLabels
} from '../lib/render';

/**
 * Sends campaign e-mails through the same provider and server-only key as the
 * account e-mails (RESEND_API_KEY, src/lib/email/notice.ts), from LevelUp's
 * verified domain with the business name as display name and Reply-To set to
 * the business. Batches of up to 50 per request with an idempotency key per
 * batch; the provider's limits are respected (pause between requests, stop on
 * 429 and let the next run continue). Never logs the key, an address or the
 * provider's message.
 */

const PROVIDER_BATCH_URL = 'https://api.resend.com/emails/batch';

/** Same verified domain as the account e-mails (AUTH_EMAIL_FROM), campaigns@ unless configured. */
export function campaignFromAddress(): string {
  const configured = process.env.CAMPAIGN_EMAIL_FROM_ADDRESS?.trim().toLowerCase();
  if (configured && isEmail(configured)) return configured;
  const auth = process.env.AUTH_EMAIL_FROM || 'LevelUp Ecosystem <account@levelup-ecosystem.com>';
  const domain =
    /@([A-Za-z0-9.-]+)>?\s*$/.exec(auth)?.[1]?.toLowerCase() ?? 'levelup-ecosystem.com';
  return `campaigns@${domain}`;
}

export function emailProviderConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export interface OutgoingEmail {
  from: string;
  to: [string];
  reply_to?: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  tags?: { name: string; value: string }[];
}

export type BatchOutcome =
  | { outcome: 'sent'; ids: string[] }
  | { outcome: 'already_sent' }
  | { outcome: 'retry'; error: string }
  | { outcome: 'failed'; error: string };

export async function sendEmailBatch(
  emails: OutgoingEmail[],
  idempotencyKey?: string
): Promise<BatchOutcome> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { outcome: 'retry', error: 'not_configured' };
  let res: Response;
  try {
    res = await fetch(PROVIDER_BATCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: JSON.stringify(emails),
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    console.warn('email batch: provider unreachable');
    return { outcome: 'retry', error: 'unreachable' };
  }
  const json = (await res.json().catch(() => ({}))) as {
    data?: { id?: unknown }[];
    name?: unknown;
  };
  if (res.ok) {
    const ids = (json.data ?? []).map((d) => (typeof d.id === 'string' ? d.id : ''));
    if (ids.length !== emails.length || ids.some((id) => !/^[A-Za-z0-9_-]{8,100}$/.test(id))) {
      // Accepted, but the answer cannot be matched: count them as sent (never send twice).
      return { outcome: 'already_sent' };
    }
    return { outcome: 'sent', ids };
  }
  // Status only: never the key, the recipients or the provider's message.
  console.warn(
    'email batch: provider refused',
    res.status,
    typeof json.name === 'string' ? json.name : ''
  );
  if (res.status === 409 && json.name === 'invalid_idempotent_request')
    return { outcome: 'already_sent' };
  if (res.status === 409 || res.status === 429 || res.status >= 500) {
    return {
      outcome: 'retry',
      error: res.status === 429 ? 'rate_limited' : `status_${res.status}`
    };
  }
  return { outcome: 'failed', error: `rejected_${res.status}` };
}

/** Footer wording in the campaign's language. */
export async function footerLabels(locale: string, site: string): Promise<FooterLabels> {
  const { t } = await getTranslatorFor(locale);
  return {
    reason: t('emails.campaign.reason', { site }),
    unsubscribe: t('emails.campaign.unsubscribe'),
    addressMissing: t('emails.campaign.addressMissing')
  };
}

export function toBrand(sender: EmailBrand): CampaignBrand {
  return {
    businessName: cleanHeader(sender.business_name || sender.site_name, 60),
    siteName: sender.site_name,
    siteDomain: sender.site_domain,
    logoUrl: sender.logo_url,
    brandColor: sender.brand_color,
    postalAddress: sender.postal_address
  };
}

export interface CampaignRow {
  id: string;
  template: CampaignTemplate;
  locale: 'en' | 'fr';
  subject: string;
  preview_text: string;
  heading: string;
  body: string;
  button_label: string | null;
  button_url: string | null;
  image_path: string | null;
}

export function toContent(c: CampaignRow): CampaignContent {
  return {
    template: c.template,
    locale: c.locale,
    subject: c.subject,
    previewText: c.preview_text,
    heading: c.heading,
    body: c.body,
    buttonLabel: c.button_label,
    buttonUrl: c.button_url,
    imageUrl: mediaPublicUrl(SUPABASE_URL, c.image_path)
  };
}

const siteLabel = (s: EmailBrand) => s.site_domain || s.site_name;

/** The test e-mail: same rendering, an inert unsubscribe link, "[Test]" in the subject. */
export async function sendTest(
  to: string,
  campaign: CampaignRow,
  sender: EmailBrand
): Promise<boolean> {
  const labels = await footerLabels(campaign.locale, siteLabel(sender));
  const urls = unsubscribeUrls(DASHBOARD_URL, 'test', campaign.id);
  const { html, text, subject } = renderCampaign(toContent(campaign), toBrand(sender), labels, {
    unsubscribeUrl: urls.page
  });
  const result = await sendEmailBatch([
    {
      from: fromHeader(sender.business_name, campaignFromAddress()),
      to: [to],
      ...(sender.reply_to ? { reply_to: sender.reply_to } : {}),
      subject: `[Test] ${subject}`,
      html,
      text,
      headers: unsubscribeHeaders(urls.oneClick)
    }
  ]);
  return result.outcome === 'sent' || result.outcome === 'already_sent';
}

// ---------------------------------------------------------------- batches

interface ClaimedBatch {
  status: 'batch';
  batch_no: number;
  campaign: CampaignRow;
  sender: EmailBrand;
  recipients: { id: number; email: string; name: string | null; token: string }[];
}
type Claim = ClaimedBatch | { status: 'idle' | 'paused' | 'done' };

/** Who drives the sending: the signed-in owner / admin, or the worker with its key. */
export interface Sender {
  claim(campaignId: string): Promise<Claim>;
  record(campaignId: string, batch: number, result: Record<string, unknown>): Promise<void>;
}

export function userSender(db: SupabaseClient): Sender {
  return {
    async claim(id) {
      const { data, error } = await db.rpc('email_campaign_claim', { p_campaign_id: id });
      if (error) throw error;
      return data as Claim;
    },
    async record(id, batch, result) {
      const { error } = await db.rpc('email_campaign_record', {
        p_campaign_id: id,
        p_batch: batch,
        p_result: result
      });
      if (error) throw error;
    }
  };
}

export function workerSender(db: SupabaseClient, key: string): Sender {
  return {
    async claim(id) {
      const { data, error } = await db.rpc('email_worker_claim', { p_key: key, p_campaign_id: id });
      if (error) throw error;
      return data as Claim;
    },
    async record(id, batch, result) {
      const { error } = await db.rpc('email_worker_record', {
        p_key: key,
        p_campaign_id: id,
        p_batch: batch,
        p_result: result
      });
      if (error) throw error;
    }
  };
}

function buildBatch(batch: ClaimedBatch, labels: FooterLabels): OutgoingEmail[] {
  const brand = toBrand(batch.sender);
  const content = toContent(batch.campaign);
  const from = fromHeader(brand.businessName, campaignFromAddress());
  return batch.recipients.map((r) => {
    const urls = unsubscribeUrls(DASHBOARD_URL, r.token, batch.campaign.id);
    const { html, text, subject } = renderCampaign(content, brand, labels, {
      unsubscribeUrl: urls.page
    });
    return {
      from,
      to: [r.email],
      ...(batch.sender.reply_to ? { reply_to: batch.sender.reply_to } : {}),
      subject,
      html,
      text,
      headers: unsubscribeHeaders(urls.oneClick),
      tags: [{ name: 'campaign', value: batch.campaign.id.replace(/[^A-Za-z0-9_-]/g, '') }]
    };
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends batches until the campaign is done, the time budget is spent, the
 * provider asks to slow down, or the website is paused. Safe to run from
 * several places at once: each batch is leased by the database.
 */
export async function processCampaign(
  sender: Sender,
  campaignId: string,
  budgetMs: number
): Promise<{ status: 'sending' | 'done' | 'paused'; sent: number }> {
  const deadline = Date.now() + budgetMs;
  let sent = 0;
  while (Date.now() < deadline) {
    const claim = await sender.claim(campaignId);
    if (claim.status !== 'batch') {
      return { status: claim.status === 'idle' ? 'sending' : claim.status, sent };
    }
    let result: BatchOutcome;
    try {
      const labels = await footerLabels(claim.campaign.locale, siteLabel(claim.sender));
      result = await sendEmailBatch(
        buildBatch(claim, labels),
        `lu-campaign-${campaignId}-batch-${claim.batch_no}`
      );
    } catch {
      // Rendering refused (missing postal address): never send without the footer.
      result = { outcome: 'failed', error: 'render_refused' };
    }
    if (result.outcome === 'sent') {
      await sender.record(campaignId, claim.batch_no, {
        outcome: 'sent',
        messages: claim.recipients.map((r, i) => ({ id: r.id, message_id: result.ids[i] }))
      });
      sent += claim.recipients.length;
    } else if (result.outcome === 'already_sent') {
      await sender.record(campaignId, claim.batch_no, { outcome: 'already_sent' });
      sent += claim.recipients.length;
    } else {
      await sender.record(campaignId, claim.batch_no, {
        outcome: result.outcome,
        error: result.error
      });
      if (result.outcome === 'retry') return { status: 'sending', sent };
    }
    // Stay well under the provider's request rate (shared with account e-mails).
    await sleep(700);
  }
  return { status: 'sending', sent };
}
