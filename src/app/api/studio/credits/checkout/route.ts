import { NextResponse, type NextRequest } from 'next/server';
import { onlinePaymentsConfig, paymentProvider, PaymentProviderError } from '@/lib/payments';
import { creditPaymentNote } from '@/lib/payments/square-form';
import { createAnonClient } from '@/lib/supabase/anon';
import { createClient } from '@/lib/supabase/server';

// LevelStudio credit top-up (5 USD for 50 credits). The studio's "Buy credits"
// button links here; the LevelUp account is the one signed in on the dashboard
// (same sign-in as the studio; not signed in: sign-in first, then back here).
// The database creates the order for that account and gives the amount; the
// buyer pays on a Square payment link and the Square webhook grants the credits.

const STUDIO = 'https://studio.levelup-ecosystem.com';
const go = (url: string) => NextResponse.redirect(url, 303);
const back = (state: 'success' | 'cancelled' | 'unavailable') =>
  go(`${STUDIO}/settings?credits=${state}#usage`);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const pack = url.searchParams.get('pack') ?? 'starter';
  if (!/^[a-z]{3,20}$/.test(pack)) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const db = await createClient();
  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) {
    const signIn = new URL('/auth/sign-in', url.origin);
    signIn.searchParams.set('next', `${url.pathname}${url.search}`);
    return go(signIn.toString());
  }

  const config = onlinePaymentsConfig();
  const square = config ? paymentProvider(config, 'square') : null;
  if (!config || !square) return back('unavailable');

  const { data, error } = await db.rpc('studio_credit_order_create', { p_pack: pack });
  if (error) {
    if (error.code !== 'PT429') console.error('studio credit order failed', error.code ?? '');
    return back('unavailable');
  }
  const order = data as {
    id: string;
    credits: number;
    amount: number;
    currency: string;
    link_id: string | null;
    email: string | null;
  };

  try {
    if (order.link_id) {
      const open = await square.getCheckout(order.link_id);
      if (open.status === 'complete') return back('success');
      if (open.status === 'open' && open.url) return go(open.url);
    }
    const fr = (request.headers.get('accept-language') ?? '').toLowerCase().startsWith('fr');
    const session = await square.createCheckout({
      chargeId: order.id,
      organizationId: '',
      invoiceNumber: `LS-${order.id.slice(0, 8)}`,
      description: `${order.credits} LevelStudio credits`,
      productName: fr
        ? `${order.credits} crédits LevelStudio`
        : `${order.credits} LevelStudio credits`,
      amount: order.amount,
      currency: order.currency,
      idempotencyKey: `levelstudio-credits-${order.id}-${order.link_id ? 2 : 1}`,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      successUrl: `${STUDIO}/settings?credits=success#usage`,
      cancelUrl: `${STUDIO}/settings?credits=cancelled#usage`,
      buyerEmail: order.email,
      paymentNote: creditPaymentNote(order.id)
    });
    if (!session.url || !session.orderId) return back('unavailable');
    const recorded = await createAnonClient().rpc('studio_credit_order_record', {
      p_key: config.billingKey,
      p_id: order.id,
      p_link_id: session.id,
      p_order_id: session.orderId
    });
    if (recorded.error) {
      console.error('studio credit order not recorded', recorded.error.code ?? '');
      return back('unavailable');
    }
    return go(session.url);
  } catch (e) {
    console.error(
      'studio credit checkout failed',
      e instanceof PaymentProviderError ? `${e.status} ${e.code ?? ''}` : 'network'
    );
    return back('unavailable');
  }
}
