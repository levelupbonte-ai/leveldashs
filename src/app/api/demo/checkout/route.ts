import { NextResponse, type NextRequest } from 'next/server';
import { onlinePaymentsConfig, paymentProvider, PaymentProviderError } from '@/lib/payments';
import { demoPaymentNote } from '@/lib/payments/square-form';
import { createAnonClient } from '@/lib/supabase/anon';
import { DEMO_CODE, DEMO_TOKEN, demoTrackingUrl } from '@/lib/demo/links';

// Human demo, 19 USD, paid on a Square payment link. The showcase's "Pay and send
// my project" button links here with the tracking code and its token (no
// session: the visitor has no LevelUp account). The database checks the code and
// the token with the billing key, gives the amount (never the browser), and the
// visitor is sent to Square; Square brings them back to the tracking page. The
// project reaches LevelUp once the Square webhook records the payment.

const go = (url: string) => NextResponse.redirect(url, 303);

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const code = params.get('c') ?? '';
  const token = params.get('k') ?? '';
  if (!DEMO_CODE.test(code) || !DEMO_TOKEN.test(token)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const tracking = (extra?: Record<string, string>) => demoTrackingUrl(code, token, extra);

  const config = onlinePaymentsConfig();
  const square = config ? paymentProvider(config, 'square') : null;
  if (!config || !square) return go(tracking({ payment: 'unavailable' }));

  const db = createAnonClient();
  const args = { p_key: config.billingKey, p_code: code, p_token: token };
  const { data, error } = await db.rpc('demo_checkout_prepare', args);
  if (error) {
    if (error.code === 'PT404') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (error.code === 'PT429') return go(tracking({ payment: 'busy' }));
    console.error('demo checkout prepare failed', error.code ?? '');
    return go(tracking({ payment: 'unavailable' }));
  }
  const prep = data as {
    request_id: string;
    paid: boolean;
    demo_status: string;
    amount: number;
    currency: string;
    link_id: string | null;
    attempt: number;
    email: string;
    locale: string;
  };
  if (prep.paid || prep.demo_status === 'cancelled') return go(tracking());

  try {
    // The link made earlier is reused while it is open (a double click or a
    // return from Square pays the same order).
    if (prep.link_id) {
      const open = await square.getCheckout(prep.link_id);
      if (open.status === 'complete') return go(tracking({ paid: '1' }));
      if (open.status === 'open' && open.url) return go(open.url);
      await db.rpc('demo_checkout_restart', args);
    }
    const fr = prep.locale === 'fr';
    const session = await square.createCheckout({
      chargeId: prep.request_id,
      organizationId: '',
      invoiceNumber: code,
      description: `${code} · ${fr ? 'Démo de site web' : 'Website demo'}`,
      productName: fr
        ? 'Démo de votre site, faite par LevelUp'
        : 'Your website demo, made by LevelUp',
      amount: prep.amount,
      currency: prep.currency,
      idempotencyKey: `levelup-demo-${prep.request_id}-${prep.attempt + 1}`,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      successUrl: tracking({ paid: '1' }),
      cancelUrl: tracking(),
      buyerEmail: prep.email,
      paymentNote: demoPaymentNote(code, prep.request_id)
    });
    if (!session.url || !session.orderId) return go(tracking({ payment: 'unavailable' }));
    const recorded = await db.rpc('demo_checkout_record', {
      ...args,
      p_link_id: session.id,
      p_order_id: session.orderId
    });
    // Not recorded: the webhook could not find the demo, so no link is shown.
    if (recorded.error) {
      console.error('demo checkout not recorded', recorded.error.code ?? '');
      return go(tracking({ payment: 'unavailable' }));
    }
    return go(session.url);
  } catch (e) {
    console.error(
      'demo checkout failed',
      e instanceof PaymentProviderError ? `${e.status} ${e.code ?? ''}` : 'network'
    );
    return go(tracking({ payment: 'unavailable' }));
  }
}
