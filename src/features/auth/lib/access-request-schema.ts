import * as z from 'zod';

/** Digits, spaces, + ( ) . - only; at least 6 characters. */
export const PHONE_PATTERN = /^\+?[0-9 ().-]{6,40}$/;
/** A domain (example.com) or an http(s) URL, no spaces. */
export const WEBSITE_PATTERN = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d{2,5})?(\/\S*)?$/i;

export interface AccessRequestMessages {
  business?: string;
  website?: string;
  phone?: string;
  tooLong?: (max: number) => string;
}

/**
 * Dashboard access request, validated in the onboarding form (with translated
 * messages) and again by POST /api/access/request (codes only). The database
 * (`submit_access_request`) trims and caps every field a third time.
 */
export function accessRequestSchema(m: AccessRequestMessages = {}) {
  const max = (n: number) => ({ message: m.tooLong?.(n) });
  const optional = (pattern: RegExp, message: string | undefined, n: number) =>
    z
      .string()
      .trim()
      .max(n, max(n))
      .refine((v) => v === '' || pattern.test(v), { message });
  return z.object({
    businessName: z.string().trim().min(2, { message: m.business }).max(120, max(120)),
    website: optional(WEBSITE_PATTERN, m.website, 200),
    phone: optional(PHONE_PATTERN, m.phone, 40),
    message: z.string().trim().max(1000, max(1000)),
    // Honeypot: hidden from people, filled by bots (see the onboarding form).
    companyUrl: z.string().max(200)
  });
}

export type AccessRequestInput = z.infer<ReturnType<typeof accessRequestSchema>>;
