import * as z from 'zod';
import { cleanLine, containsMarkup, isEmail } from './sanitize';

/**
 * The payment event a website server sends to `site_ingest_payment`
 * (docs/site-api.md). Same rules as the database function, so a site (or a
 * test) can check an event before sending it; the database re-checks
 * everything anyway.
 *
 * Provider-neutral: any allow-listed provider, generic field names, and the
 * former Stripe names (`provider_session_id`, `provider_payment_intent`,
 * `customer_email`, …) kept as aliases.
 */

export const SITE_KEY_PATTERN = /^lu_(live|test)_[0-9a-f]{48}$/;

export function isSiteKey(value: unknown): value is string {
  return typeof value === 'string' && SITE_KEY_PATTERN.test(value);
}

/** Same list as `private.site_payment_providers()` (migration 20261031100000). */
export const PAYMENT_PROVIDERS = [
  'stripe',
  'paypal',
  'square',
  'mollie',
  'lemonsqueezy',
  'paddle',
  'adyen',
  'braintree',
  'razorpay',
  'flutterwave',
  'paystack',
  'cinetpay',
  'fedapay',
  'kkiapay',
  'pesapal',
  'hubtel',
  'wave',
  'mtn_momo',
  'orange_money',
  'mpesa',
  'airtel_money',
  'moov_money',
  'bank_transfer',
  'cash_on_delivery',
  'other'
] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_METHODS = [
  'card',
  'mobile_money',
  'bank_transfer',
  'paypal',
  'cash',
  'other'
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  'paid',
  'pending',
  'failed',
  'refunded',
  'expired',
  'cancelled'
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;

/** Provider ids: letters, digits and _ . : @ / + = | # -, up to 255. */
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/+=|#-]{0,254}$/;
const OFFER_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;

const plainText = (max: number) =>
  z
    .string()
    .transform((v) => cleanLine(v))
    .refine((v) => v.length <= max, { message: 'tooLong' })
    .refine((v) => !containsMarkup(v), { message: 'noHtml' });

const email = z
  .string()
  .transform((v) => cleanLine(v).toLowerCase())
  .refine((v) => v === '' || isEmail(v), { message: 'email' });

const id = z.string().regex(PROVIDER_ID);

export const paymentEventSchema = z
  .object({
    provider: z.enum(PAYMENT_PROVIDERS),
    provider_event_id: id,
    provider_payment_id: id.optional(),
    provider_session_id: id.optional(),
    provider_transaction_id: id.optional(),
    provider_reference: id.nullable().optional(),
    provider_payment_intent: id.nullable().optional(),
    method: z.enum(PAYMENT_METHODS).nullable().optional(),
    status: z.enum(PAYMENT_STATUSES),
    amount: z.number().int().min(0).max(100_000_000_000),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
    livemode: z.boolean().nullable().optional(),
    customer: z
      .object({ email: email.nullable().optional(), name: plainText(120).nullable().optional() })
      .strict()
      .nullable()
      .optional(),
    customer_email: email.nullable().optional(),
    customer_name: plainText(120).nullable().optional(),
    offer: z
      .object({
        id: z.string().regex(OFFER_ID).nullable().optional(),
        name: plainText(200).nullable().optional()
      })
      .strict()
      .nullable()
      .optional(),
    offer_id: z.string().regex(OFFER_ID).nullable().optional(),
    offer_name: plainText(200).nullable().optional(),
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
  .strict()
  .superRefine((e, ctx) => {
    const ids = [e.provider_payment_id, e.provider_session_id, e.provider_transaction_id].filter(
      (v) => v !== undefined
    );
    if (ids.length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['provider_payment_id'], message: 'oneOf' });
    }
    const pairs: [keyof typeof e, keyof typeof e][] = [
      ['provider_reference', 'provider_payment_intent'],
      ['customer', 'customer_email'],
      ['customer', 'customer_name'],
      ['offer', 'offer_id'],
      ['offer', 'offer_name']
    ];
    for (const [a, b] of pairs) {
      if (e[a] !== undefined && e[b] !== undefined) {
        ctx.addIssue({ code: 'custom', path: [a], message: 'oneOf' });
      }
    }
    if (e.provider === 'stripe') {
      const paymentId = ids[0] ?? '';
      if (!/^evt_[A-Za-z0-9_]{1,250}$/.test(e.provider_event_id)) {
        ctx.addIssue({ code: 'custom', path: ['provider_event_id'], message: 'stripe' });
      }
      if (!/^(cs|pi|ch|in|py)_[A-Za-z0-9_]{1,250}$/.test(paymentId)) {
        ctx.addIssue({ code: 'custom', path: ['provider_payment_id'], message: 'stripe' });
      }
      const ref = e.provider_reference ?? e.provider_payment_intent;
      if (ref && !/^(pi|ch|py)_[A-Za-z0-9_]{1,250}$/.test(ref)) {
        ctx.addIssue({ code: 'custom', path: ['provider_reference'], message: 'stripe' });
      }
    }
  });

export type PaymentEvent = z.input<typeof paymentEventSchema>;
