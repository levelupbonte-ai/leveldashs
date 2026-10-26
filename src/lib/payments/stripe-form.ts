import type { CheckoutRequest } from './types';

type FormValue = string | number | boolean | null | undefined | FormObject | FormValue[];
interface FormObject {
  [key: string]: FormValue;
}

/** Stripe's form encoding: nested keys as `a[b][0][c]=…`, nulls left out. */
export function encodeForm(data: FormObject, prefix = ''): string {
  const parts: string[] = [];
  const walk = (value: FormValue, key: string) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof value === 'object')
      Object.entries(value).forEach(([k, v]) => walk(v, key ? `${key}[${k}]` : k));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  walk(data, prefix);
  return parts.join('&');
}

/**
 * Checkout Session parameters. Deterministic for one attempt (no clock, no user
 * locale or e-mail), so a replay with the same idempotency key is the same request.
 */
export function checkoutSessionParams(request: CheckoutRequest): FormObject {
  const metadata = {
    charge_id: request.chargeId,
    organization_id: request.organizationId,
    invoice_number: request.invoiceNumber
  };
  return {
    mode: 'payment',
    client_reference_id: request.chargeId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: request.currency.toLowerCase(),
          unit_amount: request.amount,
          product_data: { name: request.description.slice(0, 250) }
        }
      }
    ],
    metadata,
    payment_intent_data: { metadata, description: request.description.slice(0, 250) },
    expires_at: Math.floor(request.expiresAt.getTime() / 1000),
    success_url: request.successUrl,
    cancel_url: request.cancelUrl
  };
}
