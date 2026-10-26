import 'server-only';
import { readOnlinePaymentsConfig, type OnlinePaymentsConfig } from './config';
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

export function paymentProvider(config: OnlinePaymentsConfig): PaymentProvider {
  return createStripeProvider(config.secretKey);
}

export type { OnlinePaymentsConfig } from './config';
export { PaymentProviderError } from './types';
