import * as z from 'zod';
import { cleanLine, containsMarkup, isEmail } from './sanitize';

/**
 * The payment event a website server sends to `site_ingest_payment`
 * (docs/site-api.md). Same rules as the database function, so a site (or a
 * test) can check an event before sending it; the database re-checks
 * everything anyway.
 */

export const SITE_KEY_PATTERN = /^lu_(live|test)_[0-9a-f]{48}$/;

export function isSiteKey(value: unknown): value is string {
  return typeof value === 'string' && SITE_KEY_PATTERN.test(value);
}

const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;

const plainText = (max: number) =>
  z
    .string()
    .transform((v) => cleanLine(v))
    .refine((v) => v.length <= max, { message: 'tooLong' })
    .refine((v) => !containsMarkup(v), { message: 'noHtml' });

export const paymentEventSchema = z
  .object({
    provider: z.literal('stripe'),
    provider_event_id: z.string().regex(/^evt_[A-Za-z0-9_]{1,250}$/),
    provider_session_id: z.string().regex(/^cs_[A-Za-z0-9_]{1,250}$/),
    provider_payment_intent: z
      .string()
      .regex(/^pi_[A-Za-z0-9_]{1,250}$/)
      .nullable()
      .optional(),
    status: z.enum(['paid', 'pending', 'failed', 'refunded', 'expired']),
    amount: z.number().int().min(0).max(100_000_000_000),
    currency: z.string().regex(/^[a-z]{3}$/),
    offer_id: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/)
      .nullable()
      .optional(),
    offer_name: plainText(200).nullable().optional(),
    customer_email: z
      .string()
      .transform((v) => cleanLine(v).toLowerCase())
      .refine((v) => isEmail(v), { message: 'email' })
      .nullable()
      .optional(),
    customer_name: plainText(120).nullable().optional(),
    occurred_at: z
      .string()
      .regex(ISO_WITH_ZONE)
      .refine((v) => {
        const t = Date.parse(v);
        return Number.isFinite(t) && t >= Date.UTC(2015, 0, 1) && t <= Date.now() + 86_400_000;
      }),
    metadata: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .refine((v) => !v || JSON.stringify(v).length <= 8192, { message: 'tooLarge' })
  })
  .strict();

export type PaymentEvent = z.input<typeof paymentEventSchema>;
