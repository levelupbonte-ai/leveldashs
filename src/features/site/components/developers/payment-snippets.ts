// Payment reporting samples shown on the Developers page (code, not prose:
// not translated). Each provider sample maps that provider's documented
// webhook / notification to the LevelUp event (docs/site-api.md). Where a
// provider's payload varies by API version, the sample says to check it.

import { THREE_DECIMAL_CURRENCIES, ZERO_DECIMAL_CURRENCIES } from '@/features/payments/lib/money';

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

export const EVENT_SNIPPET = `{
  "provider": "paystack",
  "provider_event_id": "charge.success:4099260516",
  "provider_payment_id": "T458123456789",
  "provider_reference": "4099260516",
  "method": "card",
  "status": "paid",
  "amount": 2500000,
  "currency": "NGN",
  "customer": { "email": "ama@example.com", "name": "Ama Owusu" },
  "offer": { "id": "starter-box", "name": "Starter box" },
  "occurred_at": "2026-10-20T14:00:00Z",
  "metadata": {}
}`;

/** The shared helper every sample imports: minor units + the call itself. */
export const HELPER_SNIPPET = `// lib/levelup.ts (server only)
// Amounts go to LevelUp in the currency's ISO 4217 minor unit.
const ZERO_DECIMAL = new Set([${list(ZERO_DECIMAL_CURRENCIES)}]);
const THREE_DECIMAL = new Set([${list(THREE_DECIMAL_CURRENCIES)}]);

/** 25.00 USD -> 2500 ; 15000 XOF -> 15000 ; "10.00" -> 1000 */
export function toMinor(amount: number | string, currency: string): number {
  const code = currency.toLowerCase();
  const exponent = ZERO_DECIMAL.has(code) ? 0 : THREE_DECIMAL.has(code) ? 3 : 2;
  return Math.round(Number(amount) * 10 ** exponent);
}

export async function reportPayment(event: Record<string, unknown>) {
  const response = await fetch(process.env.LEVELUP_API_URL!, {
    method: 'POST',
    headers: {
      apikey: process.env.LEVELUP_PUBLIC_KEY!,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_key: process.env.LEVELUP_SITE_KEY, p_event: event })
  });
  // 200 { applied: false } is not an error (duplicate or older event).
  if (!response.ok) throw new Error(\`LevelUp answered \${response.status}\`);
  return response.json();
}`;

export const STRIPE_SNIPPET = `// app/api/stripe/webhook/route.ts (server only)
import Stripe from 'stripe';
import { reportPayment } from '@/lib/levelup';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const event = stripe.webhooks.constructEvent(
    await request.text(),
    request.headers.get('stripe-signature')!,
    process.env.STRIPE_WEBHOOK_SECRET!
  );

  let session: Stripe.Checkout.Session | undefined;
  let status: 'paid' | 'pending' | 'failed' | 'expired' | 'refunded' | undefined;
  if (event.type.startsWith('checkout.session.')) {
    session = event.data.object as Stripe.Checkout.Session;
    status =
      event.type === 'checkout.session.expired' ? 'expired'
      : event.type === 'checkout.session.async_payment_failed' ? 'failed'
      : session.payment_status === 'paid' ? 'paid'
      : 'pending';
  } else if (event.type === 'charge.refunded') {
    // A refund only knows the payment intent: find its Checkout session.
    const charge = event.data.object as Stripe.Charge;
    const sessions = await stripe.checkout.sessions.list({
      payment_intent: charge.payment_intent as string,
      limit: 1
    });
    session = sessions.data[0];
    status = 'refunded';
  }
  if (!session || !status) return Response.json({ ok: true });

  try {
    await reportPayment({
      provider: 'stripe',
      provider_event_id: event.id,
      provider_payment_id: session.id,
      provider_reference:
        typeof session.payment_intent === 'string' ? session.payment_intent : null,
      method: 'card',
      status,
      amount: session.amount_total ?? 0, // Stripe already uses minor units
      currency: session.currency ?? 'usd',
      customer: {
        email: session.customer_details?.email ?? null,
        name: session.customer_details?.name ?? null
      },
      offer: {
        id: session.metadata?.offer_id ?? null,
        name: session.metadata?.offer_name ?? null
      },
      livemode: event.livemode,
      occurred_at: new Date(event.created * 1000).toISOString()
    });
  } catch {
    return new Response(null, { status: 502 }); // Stripe retries
  }
  return Response.json({ ok: true });
}`;

export const PAYPAL_SNIPPET = `// app/api/paypal/webhook/route.ts (server only)
// Subscribe the webhook to PAYMENT.CAPTURE.COMPLETED, .PENDING, .DENIED and .REFUNDED.
import { reportPayment, toMinor } from '@/lib/levelup';

const PAYPAL_API = process.env.PAYPAL_API_URL!; // https://api-m.paypal.com (sandbox: https://api-m.sandbox.paypal.com)

async function paypalToken() {
  const auth = Buffer.from(
    \`\${process.env.PAYPAL_CLIENT_ID}:\${process.env.PAYPAL_CLIENT_SECRET}\`
  ).toString('base64');
  const res = await fetch(\`\${PAYPAL_API}/v1/oauth2/token\`, {
    method: 'POST',
    headers: { Authorization: \`Basic \${auth}\`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  return (await res.json()).access_token as string;
}

export async function POST(request: Request) {
  const event = await request.json();
  const h = request.headers;
  // Ask PayPal to verify the signature of this delivery.
  const check = await fetch(\`\${PAYPAL_API}/v1/notifications/verify-webhook-signature\`, {
    method: 'POST',
    headers: { Authorization: \`Bearer \${await paypalToken()}\`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: h.get('paypal-auth-algo'),
      cert_url: h.get('paypal-cert-url'),
      transmission_id: h.get('paypal-transmission-id'),
      transmission_sig: h.get('paypal-transmission-sig'),
      transmission_time: h.get('paypal-transmission-time'),
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: event
    })
  });
  if ((await check.json()).verification_status !== 'SUCCESS') {
    return new Response(null, { status: 400 });
  }

  const statuses: Record<string, string> = {
    'PAYMENT.CAPTURE.COMPLETED': 'paid',
    'PAYMENT.CAPTURE.PENDING': 'pending',
    'PAYMENT.CAPTURE.DENIED': 'failed',
    'PAYMENT.CAPTURE.REFUNDED': 'refunded'
  };
  const status = statuses[event.event_type];
  if (!status) return Response.json({ ok: true });

  const resource = event.resource;
  // On a refund the resource is the refund: its "up" link points to the capture.
  const captureId =
    status === 'refunded'
      ? resource.links?.find((l: { rel: string }) => l.rel === 'up')?.href.split('/').pop()
      : resource.id;
  try {
    await reportPayment({
      provider: 'paypal',
      provider_event_id: event.id, // WH-…
      provider_payment_id: captureId,
      provider_reference: resource.supplementary_data?.related_ids?.order_id ?? null,
      method: 'paypal',
      status,
      amount: toMinor(resource.amount.value, resource.amount.currency_code), // "10.00" -> 1000
      currency: resource.amount.currency_code,
      // Payer details are on the order (GET /v2/checkout/orders/{id}) if you need them.
      offer: { id: resource.custom_id ?? null, name: null },
      occurred_at: event.create_time
    });
  } catch {
    return new Response(null, { status: 502 }); // PayPal retries
  }
  return Response.json({ ok: true });
}`;

export const FLUTTERWAVE_SNIPPET = `// app/api/flutterwave/webhook/route.ts (server only)
// v3 webhooks. Check your provider's webhook payload if your account uses another version.
import { reportPayment, toMinor } from '@/lib/levelup';

export async function POST(request: Request) {
  // The "verif-hash" header carries the secret hash set in your Flutterwave dashboard.
  if (request.headers.get('verif-hash') !== process.env.FLW_SECRET_HASH) {
    return new Response(null, { status: 401 });
  }
  const { event, data } = await request.json();
  if (event !== 'charge.completed') return Response.json({ ok: true });

  // Re-read the transaction from Flutterwave: the webhook body is only a hint.
  const res = await fetch(\`https://api.flutterwave.com/v3/transactions/\${data.id}/verify\`, {
    headers: { Authorization: \`Bearer \${process.env.FLW_SECRET_KEY}\` }
  });
  const tx = (await res.json()).data;
  const status =
    tx.status === 'successful' ? 'paid' : tx.status === 'failed' ? 'failed' : 'pending';
  const type = String(tx.payment_type ?? '');
  const method =
    type === 'card' ? 'card'
    : type.startsWith('mobilemoney') || type === 'mpesa' ? 'mobile_money'
    : type === 'bank_transfer' || type === 'account' ? 'bank_transfer'
    : 'other';

  try {
    await reportPayment({
      provider: 'flutterwave',
      provider_event_id: \`\${tx.id}:\${tx.status}\`, // no event id: transaction + status
      provider_payment_id: String(tx.id),
      provider_reference: tx.tx_ref, // your own reference
      method,
      status,
      amount: toMinor(tx.amount, tx.currency), // Flutterwave amounts are in major units
      currency: tx.currency,
      customer: { email: tx.customer?.email ?? null, name: tx.customer?.name ?? null },
      offer: { id: tx.meta?.offer_id ?? null, name: tx.meta?.offer_name ?? null },
      occurred_at: new Date(tx.created_at).toISOString()
    });
  } catch {
    return new Response(null, { status: 502 }); // Flutterwave retries
  }
  return Response.json({ ok: true });
}`;

export const PAYSTACK_SNIPPET = `// app/api/paystack/webhook/route.ts (server only)
import { createHmac, timingSafeEqual } from 'node:crypto';
import { reportPayment } from '@/lib/levelup';

export async function POST(request: Request) {
  const body = await request.text();
  // x-paystack-signature: HMAC SHA-512 of the raw body with your secret key.
  const expected = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(body).digest('hex');
  const received = request.headers.get('x-paystack-signature') ?? '';
  if (
    received.length !== expected.length ||
    !timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  ) {
    return new Response(null, { status: 401 });
  }
  const { event, data } = JSON.parse(body);
  if (event !== 'charge.success') {
    // Refunds (refund.processed, …): check your provider's webhook payload for the
    // transaction reference, then send it as provider_payment_id with status "refunded".
    return Response.json({ ok: true });
  }

  const channel = String(data.channel ?? '');
  try {
    await reportPayment({
      provider: 'paystack',
      provider_event_id: \`\${event}:\${data.id}\`,
      provider_payment_id: data.reference, // the reference you initialised
      provider_reference: String(data.id),
      method:
        channel === 'card' ? 'card'
        : channel === 'mobile_money' ? 'mobile_money'
        : channel === 'bank' || channel === 'bank_transfer' ? 'bank_transfer'
        : 'other',
      status: 'paid',
      amount: data.amount, // Paystack already sends the subunit (kobo, pesewas, cents)
      currency: data.currency,
      customer: {
        email: data.customer?.email ?? null,
        name: [data.customer?.first_name, data.customer?.last_name].filter(Boolean).join(' ') || null
      },
      offer: { id: data.metadata?.offer_id ?? null, name: data.metadata?.offer_name ?? null },
      livemode: data.domain === 'live',
      occurred_at: new Date(data.paid_at ?? data.created_at).toISOString()
    });
  } catch {
    return new Response(null, { status: 502 }); // Paystack retries
  }
  return new Response(null, { status: 200 });
}`;

export const CINETPAY_SNIPPET = `// app/api/cinetpay/notify/route.ts (server only) - your notify_url
// CinetPay posts a form (cpm_site_id, cpm_trans_id, …). Like CinetPay recommends,
// the status is read back from its check API, never from the notification itself.
import { reportPayment, toMinor } from '@/lib/levelup';

export async function POST(request: Request) {
  const form = await request.formData();
  const transactionId = String(form.get('cpm_trans_id') ?? '');
  if (form.get('cpm_site_id') !== process.env.CINETPAY_SITE_ID || !transactionId) {
    return new Response(null, { status: 400 });
  }

  const res = await fetch('https://api-checkout.cinetpay.com/v2/payment/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: process.env.CINETPAY_API_KEY,
      site_id: process.env.CINETPAY_SITE_ID,
      transaction_id: transactionId
    })
  });
  const { data } = await res.json();
  // ACCEPTED and REFUSED are final; check your provider's docs for the other values.
  const status =
    data.status === 'ACCEPTED' ? 'paid' : data.status === 'REFUSED' ? 'failed' : 'pending';
  const operator = String(data.payment_method ?? '');

  try {
    await reportPayment({
      provider: 'cinetpay',
      provider_event_id: \`\${transactionId}:\${data.status}\`,
      provider_payment_id: transactionId, // the transaction_id you created
      provider_reference: data.operator_id ?? null,
      method: /CARD|VISA|MASTER/i.test(operator) ? 'card' : 'mobile_money',
      status,
      amount: toMinor(data.amount, data.currency), // XOF / XAF: no minor unit, 15000 stays 15000
      currency: data.currency,
      occurred_at: new Date().toISOString(),
      metadata: { operator }
    });
  } catch {
    return new Response(null, { status: 502 });
  }
  return new Response(null, { status: 200 });
}`;

export const GENERIC_SNIPPET = `// Any provider, or your own order system (bank transfer, cash on delivery, …).
// Call it from your server once the payment's state is known for sure.
import { reportPayment, toMinor } from '@/lib/levelup';

await reportPayment({
  provider: 'cash_on_delivery', // one of the supported slugs, or 'other'
  provider_event_id: \`\${order.id}:\${order.status}\`, // unique per state change
  provider_payment_id: order.id, // one payment per id (and per provider)
  provider_reference: order.trackingNumber ?? null,
  method: 'cash', // card | mobile_money | bank_transfer | paypal | cash | other
  status: order.delivered ? 'paid' : 'pending', // paid | pending | failed | refunded | expired | cancelled
  amount: toMinor(order.total, order.currency), // 15000 XOF -> 15000, 25.00 EUR -> 2500
  currency: order.currency,
  customer: { email: order.email ?? null, name: order.name ?? null },
  offer: { id: order.sku ?? null, name: order.title ?? null },
  occurred_at: new Date().toISOString(),
  metadata: { city: order.city }
});`;

export const PROVIDER_EXAMPLES = [
  { key: 'stripe', label: 'Stripe', file: 'app/api/stripe/webhook/route.ts', code: STRIPE_SNIPPET },
  { key: 'paypal', label: 'PayPal', file: 'app/api/paypal/webhook/route.ts', code: PAYPAL_SNIPPET },
  {
    key: 'flutterwave',
    label: 'Flutterwave',
    file: 'app/api/flutterwave/webhook/route.ts',
    code: FLUTTERWAVE_SNIPPET
  },
  {
    key: 'paystack',
    label: 'Paystack',
    file: 'app/api/paystack/webhook/route.ts',
    code: PAYSTACK_SNIPPET
  },
  {
    key: 'cinetpay',
    label: 'CinetPay',
    file: 'app/api/cinetpay/notify/route.ts',
    code: CINETPAY_SNIPPET
  },
  { key: 'generic', label: null, file: 'server', code: GENERIC_SNIPPET }
] as const;
