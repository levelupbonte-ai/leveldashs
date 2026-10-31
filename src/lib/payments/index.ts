import 'server-only';
import {
  readOnlinePaymentsConfig,
  type OnlinePaymentsConfig,
  type PaymentProviderName
} from './config';
import { createSquareProvider } from './square';
import { createStripeProvider } from './stripe';
import type { PaymentProvider } from './types';

/** Server env only (never NEXT_PUBLIC_). Null = online payments are off. */
export function onlinePaymentsConfig(): OnlinePaymentsConfig | null {
  return readOnlinePaymentsConfig(process.env);
}

/** True when the "Pay online" button and the payment routes are available. */
export function onlinePaymentsEnabled(): boolean {
  return onlinePaymentsConfig() !== null;
}

/** Staff screens only: which provider takes payments (never shown to clients). */
export function onlinePaymentsProvider(): PaymentProviderName | null {
  return onlinePaymentsConfig()?.provider ?? null;
}

/** Which provider created a checkout session id (Stripe ids start with cs_). */
export function providerOfSession(id: string): PaymentProviderName {
  return id.startsWith('cs_') ? 'stripe' : 'square';
}

/** The provider by name, or null when its keys are not configured. */
export function paymentProvider(
  config: OnlinePaymentsConfig,
  name: PaymentProviderName = config.provider
): PaymentProvider | null {
  if (name === 'stripe')
    return config.stripe ? createStripeProvider(config.stripe.secretKey) : null;
  return config.square ? createSquareProvider(config.square) : null;
}

export type { OnlinePaymentsConfig, PaymentProviderName } from './config';
export { PaymentProviderError } from './types';
