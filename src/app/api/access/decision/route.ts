import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { dbErrorCode, ERROR_STATUS } from '@/lib/access/db-errors';
import { sendDecisionEmail, type ApprovalResult } from '@/lib/email/access-emails';
import { createClient } from '@/lib/supabase/server';
import { fields } from '@/lib/validation/fields';
import { readJsonBody } from '@/lib/validation/http';

// LevelUp staff decide on an access request, explicitly: connect the account to
// an existing website (by its id), create a new client, or decline. The database
// checks everything (platform admin on aal2, confirmed e-mail, archived sites,
// duplicates, second confirmation when the organization already has an owner)
// and audits the decision; the applicant is told by e-mail.

const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;

const Body = z.strictObject({
  userId: z.uuid(),
  mode: z.enum(['connect', 'create', 'reject']),
  websiteId: fields.websiteId().optional(),
  role: z.enum(ROLES).optional(),
  confirmWebsiteId: z.string().max(40).optional(),
  organizationName: fields.text(120).optional(),
  websiteName: fields.text(120).optional(),
  websiteDomain: z.string().max(253).optional()
});

export async function POST(request: NextRequest) {
  // Same origin (CSRF), JSON only, 2 KB at most, unknown keys refused.
  const parsed = await readJsonBody(request, Body, { maxBytes: 2048 });
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;
  const db = await createClient();
  const { data, error } = await db.rpc('admin_review_access_request', {
    p_user_id: b.userId,
    p_mode: b.mode,
    p_website_id: b.websiteId || null,
    p_role: b.role ?? null,
    p_confirm_website_id: b.confirmWebsiteId || null,
    p_organization_name: b.organizationName || null,
    p_website_name: b.websiteName || null,
    p_website_domain: b.websiteDomain || null
  });
  if (error) {
    // Codes only: the database message stays a short code, never shown as is.
    const code = dbErrorCode(error, 'reviewFailed');
    console.error('admin_review_access_request failed', error.code, code);
    return NextResponse.json({ error: code }, { status: ERROR_STATUS[code] ?? 400 });
  }
  const result = data as ApprovalResult & {
    mode: string;
    organization_id?: string;
    website_id?: string | null;
    role?: string;
    unchanged?: boolean;
    archived_organization_id?: string | null;
  };
  // The same decision twice: no second e-mail.
  const emailSent = result.unchanged ? false : await sendDecisionEmail(result);
  return NextResponse.json({
    status: result.status,
    mode: result.mode,
    organizationId: result.organization_id ?? null,
    organizationName: result.organization_name ?? null,
    websiteId: result.website_id ?? null,
    websiteName: result.website_name ?? null,
    role: result.role ?? null,
    archivedOrganizationId: result.archived_organization_id ?? null,
    unchanged: !!result.unchanged,
    emailSent
  });
}
