import 'server-only';
import {
  diagnoseOnlinePayments,
  readOnlinePaymentsConfig,
  type OnlinePaymentsConfig,
  type PaymentMethodChoice,
  type PaymentProviderName
} from './config';
import { createPayPalProvider, type PayPalProvider } from './paypal';
import { createSquareProvider } from './square';
import { createStripeProvider } from './stripe';
import type { PaymentProvider } from './types';

/** Server env only (never NEXT_PUBLIC_). Null = online payments are off. */
export function onlinePaymentsConfig(): OnlinePaymentsConfig | null {
  const config = readOnlinePaymentsConfig(process.env);
  if (!config) {
    // Off: say which variables are missing or refused (names only, never values).
    console.error('billing.online_payments_off', diagnoseOnlinePayments(process.env).join(', '));
  }
  return config;
}

/** True when the "Pay online" button and the payment routes are available. */
export function onlinePaymentsEnabled(): boolean {
  return onlinePaymentsConfig() !== null;
}

/** LevelUp staff only: why online payments are off (variable names, never values). */
export function onlinePaymentsProblems(): string[] {
  return diagnoseOnlinePayments(process.env);
}

/** What the payer can choose (card, PayPal), empty when online payments are off. */
export function onlinePaymentMethods(): PaymentMethodChoice[] {
  return onlinePaymentsConfig()?.methods ?? [];
}

/** Staff screens only: which provider takes payments (never shown to clients). */
export function onlinePaymentsProvider(): PaymentProviderName | null {
  return onlinePaymentsConfig()?.provider ?? null;
}

/** Which provider created a checkout session id (Stripe cs_, PayPal pp_, else Square). */
export function providerOfSession(id: string): PaymentProviderName {
  if (id.startsWith('cs_')) return 'stripe';
  if (id.startsWith('pp_')) return 'paypal';
  return 'square';
}

/** PayPal with its extra calls (capture, webhook check), or null when not set up. */
export function paypalProvider(config: OnlinePaymentsConfig): PayPalProvider | null {
  return config.paypal ? createPayPalProvider(config.paypal) : null;
}

/** The provider by name, or null when its keys are not configured. */
export function paymentProvider(
  config: OnlinePaymentsConfig,
  name: PaymentProviderName = config.provider
): PaymentProvider | null {
  if (name === 'stripe')
    return config.stripe ? createStripeProvider(config.stripe.secretKey) : null;
  if (name === 'paypal') return paypalProvider(config);
  return config.square ? createSquareProvider(config.square) : null;
}

export type { OnlinePaymentsConfig, PaymentMethodChoice, PaymentProviderName } from './config';
export { PaymentProviderError } from './types';
