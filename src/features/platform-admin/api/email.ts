import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { rpc } from '@/lib/supabase/rpc-error';

// LevelUp staff (aal2): the e-mail worker key and the websites whose campaign
// sending was paused automatically (bounces or complaints). Audited in the database.

export interface EmailSendingStatus {
  key: {
    active: boolean;
    key_hint: string | null;
    created_at: string | null;
    last_used_at: string | null;
  };
  last_event_at: string | null;
  paused: {
    website_id: string;
    website_name: string;
    organization_name: string;
    paused_at: string;
    reason: 'bounces' | 'complaints' | 'staff';
    detail: { sent?: number; bounced?: number; complained?: number } | null;
  }[];
}

export const adminEmailKeys = { status: ['admin', 'email-sending'] as const };

export const emailSendingStatusQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminEmailKeys.status,
    queryFn: () => rpc<EmailSendingStatus>(db.rpc('admin_email_status'))
  });

/** Returns the new key once (`lu_mail_…`); the previous key stops working at once. */
export async function createEmailWorkerKey(db: SupabaseClient): Promise<string> {
  return (await rpc<{ key: string }>(db.rpc('admin_create_email_worker_key'))).key;
}

export function resumeEmailSending(db: SupabaseClient, websiteId: string) {
  return rpc<null>(db.rpc('admin_email_resume_site', { p_website_id: websiteId }));
}
