import * as z from 'zod';
import { createFields, type FieldMessages } from '@/lib/validation/fields';

export interface AccessRequestMessages extends FieldMessages {
  business?: string;
}

/**
 * Dashboard access request, validated in the onboarding form (with translated
 * messages) and again by POST /api/access/request (codes only, strict: unknown
 * keys are refused). Strings are cleaned (hidden characters, whitespace), HTML
 * is refused, the website must be an http(s) link. The database
 * (`submit_access_request`) trims and caps every field a third time.
 */
export function accessRequestSchema(m: AccessRequestMessages = {}) {
  const f = createFields(m);
  return z.object({
    businessName: f.text(120).refine((v) => v.length >= 2, { message: m.business }),
    website: f.url({ allowBareDomain: true }),
    phone: f.phone(),
    message: f.text(1000, { multiline: true }),
    // Honeypot: hidden from people, filled by bots (see the onboarding form).
    companyUrl: z.string().max(200)
  });
}

export type AccessRequestInput = z.infer<ReturnType<typeof accessRequestSchema>>;
