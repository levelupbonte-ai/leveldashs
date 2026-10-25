import type { ErrorCode } from '@/lib/errors';

/**
 * Database answers of the access functions (review, invitations, owner e-mail,
 * activation codes) as `errors.*` message keys. The database raises short codes
 * (`already_member`, …) as the message, never anything to show as is.
 */
const BY_MESSAGE: Record<string, ErrorCode> = {
  email_unconfirmed: 'emailUnconfirmed',
  invalid_website_id: 'invalidWebsiteId',
  website_not_found: 'websiteNotFound',
  website_archived: 'websiteArchived',
  already_member: 'alreadyMember',
  already_approved: 'alreadyApproved',
  confirmation_required: 'confirmationRequired',
  choose_site_or_create: 'confirmationRequired',
  invalid_role: 'invalidValues',
  invalid_name: 'invalidValues',
  invalid_mode: 'invalidValues',
  invalid_domain: 'invalidDomain',
  domain_taken: 'domainTaken',
  invalid_email: 'invalidEmail',
  request_not_found: 'requestNotFound',
  invitation_not_found: 'invitationNotFound',
  invitation_accepted: 'invitationAccepted',
  invitation_revoked: 'invitationRevoked',
  organization_has_owner: 'organizationHasOwner',
  email_pending_elsewhere: 'emailPendingElsewhere',
  too_many_codes: 'tooManyCodes',
  code_not_found: 'requestNotFound'
};

/** Every code a route handler of these flows may return as `{ error }`. */
export const ACCESS_ERROR_CODES = new Set<ErrorCode>([
  ...Object.values(BY_MESSAGE),
  'mfaRequired',
  'forbidden',
  'rateLimited',
  'sessionExpired',
  'reviewFailed',
  'inviteFailed',
  'generic'
]);

export function dbErrorCode(
  error: { code?: string; message?: string } | null | undefined,
  fallback: ErrorCode = 'generic'
): ErrorCode {
  if (!error) return fallback;
  const message = error.message ?? '';
  if (message.includes('aal2')) return 'mfaRequired';
  if (BY_MESSAGE[message]) return BY_MESSAGE[message];
  if (error.code === 'PT429') return 'rateLimited';
  if (error.code === 'PT403' || error.code === '42501') return 'forbidden';
  return fallback;
}

/** A route handler's `{ error }` back to a known code (anything else is generic). */
export function responseErrorCode(value: unknown): ErrorCode {
  // readJsonBody's own codes (validation, size, content type).
  if (value === 'invalid' || value === 'too_large' || value === 'unsupported_media_type') {
    return 'invalidValues';
  }
  return typeof value === 'string' && ACCESS_ERROR_CODES.has(value as ErrorCode)
    ? (value as ErrorCode)
    : 'generic';
}

export const ERROR_STATUS: Partial<Record<ErrorCode, number>> = {
  mfaRequired: 403,
  forbidden: 403,
  emailUnconfirmed: 403,
  rateLimited: 429,
  websiteNotFound: 404,
  requestNotFound: 404,
  invitationNotFound: 404
};
