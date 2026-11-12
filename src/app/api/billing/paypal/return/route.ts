import { NextResponse, type NextRequest } from 'next/server';
import { onlinePaymentsConfig, paypalProvider, PaymentProviderError } from '@/lib/payments';
import { captureAndRecord } from '@/lib/payments/paypal-capture';

// PayPal sends the payer back here after approving the order
// (?token=<order id>&PayerID=…). LevelUp captures the order (the money moves
// now), records it, and sends the payer to the billing page. A payer who
// closes the tab is covered by the CHECKOUT.ORDER.APPROVED webhook.

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const to = (payment: 'success' | 'pending' | 'failed') =>
    NextResponse.redirect(new URL(`/dashboard/billing?payment=${payment}`, url.origin), 303);

  const config = onlinePaymentsConfig();
  const paypal = config ? paypalProvider(config) : null;
  if (!config || !paypal) return to('failed');
  const orderId = url.searchParams.get('token') ?? '';

  try {
    const outcome = await captureAndRecord(config, paypal, orderId);
    if (outcome === 'paid' || outcome === 'not_due') return to('success');
    if (outcome === 'pending') return to('pending');
    return to('failed');
  } catch (e) {
    console.error(
      'paypal return failed',
      e instanceof PaymentProviderError ? `${e.status} ${e.code ?? ''}` : 'network'
    );
    return to('failed');
  }
}
