// Code samples shown on the Developers page (code, not prose: not translated).

export const TAG_URL = 'https://levelup-ecosystem.com/sdk/v1/levelup.js';

export const tagSnippet = (siteId: string) =>
  `<script src="${TAG_URL}" data-site="${siteId}" defer></script>`;

export const nextScriptSnippet = (siteId: string) => `import Script from 'next/script';

// app/layout.tsx
<Script src="${TAG_URL}" data-site="${siteId}" strategy="afterInteractive" />`;

export const tagOptionsSnippet = (siteId: string) =>
  `<script src="${TAG_URL}" data-site="${siteId}"
  data-seo="off" data-forms="off" data-analytics="off" defer></script>`;

export const FORM_SNIPPET = `<form data-lu-form="contact">
  <input name="name" required>
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off">
  <button type="submit">Send</button>
  <p data-lu-status></p>
</form>`;

export const CONTENT_SNIPPET = `<span data-lu="settings.contact.address"></span>
<img data-lu="settings.branding.logo_url" data-lu-attr="src" alt="Logo">
<footer><span data-lu-badge></span></footer>`;

export const JS_API_SNIPPET = `const site = await LevelUp.ready;

await LevelUp.submitForm('quote', { name, email, message, budget: '5k' });
await LevelUp.bookAppointment({
  service: 'haircut', date: '2026-11-12', time: '10:00', name, email
});
await LevelUp.joinWaitlist({ name, phone });
const queue = await LevelUp.waitlist();
const ticket = await LevelUp.ticketStatus('FS-ABCD1234');

document.addEventListener('levelup:ready', (event) => {
  console.log(event.detail.services);
});`;

export const envSnippet = (endpoint: string, publicKey: string) =>
  `LEVELUP_API_URL=${endpoint}
LEVELUP_PUBLIC_KEY=${publicKey}
LEVELUP_SITE_KEY=lu_live_...`;

export const EVENT_SNIPPET = `{
  "provider": "stripe",
  "provider_event_id": "evt_1Q...",
  "provider_session_id": "cs_live_a1...",
  "provider_payment_intent": "pi_3P...",
  "status": "paid",
  "amount": 26000,
  "currency": "usd",
  "offer_id": "travel-support",
  "offer_name": "Travel support",
  "customer_email": "jane@example.com",
  "customer_name": "Jane Doe",
  "occurred_at": "2026-10-20T14:00:00Z",
  "metadata": {}
}`;

export const WEBHOOK_SNIPPET = `// app/api/stripe/webhook/route.ts (server only)
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const body = await request.text();
  const event = stripe.webhooks.constructEvent(
    body,
    request.headers.get('stripe-signature')!,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
  if (!event.type.startsWith('checkout.session.')) return Response.json({ ok: true });

  const session = event.data.object as Stripe.Checkout.Session;
  const status =
    event.type === 'checkout.session.expired' ? 'expired'
    : event.type === 'checkout.session.async_payment_failed' ? 'failed'
    : session.payment_status === 'paid' ? 'paid'
    : 'pending';

  const response = await fetch(process.env.LEVELUP_API_URL!, {
    method: 'POST',
    headers: {
      apikey: process.env.LEVELUP_PUBLIC_KEY!,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_key: process.env.LEVELUP_SITE_KEY,
      p_event: {
        provider: 'stripe',
        provider_event_id: event.id,
        provider_session_id: session.id,
        provider_payment_intent:
          typeof session.payment_intent === 'string' ? session.payment_intent : null,
        status,
        amount: session.amount_total ?? 0,
        currency: session.currency ?? 'usd',
        offer_id: session.metadata?.offer_id ?? null,
        offer_name: session.metadata?.offer_name ?? null,
        customer_email: session.customer_details?.email ?? null,
        customer_name: session.customer_details?.name ?? null,
        occurred_at: new Date(event.created * 1000).toISOString(),
        metadata: {}
      }
    })
  });
  // A 5xx makes Stripe retry; { applied: false } is not an error.
  return new Response(null, { status: response.ok ? 200 : 502 });
}`;

export const CURL_SNIPPET = (endpoint: string) => `curl -X POST '${endpoint}' \\
  -H "apikey: $LEVELUP_PUBLIC_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "p_key": "'"$LEVELUP_SITE_KEY"'", "p_event": { ... } }'`;
