/**
 * Online payment of LevelUp charges: switched off unless the server environment
 * turns it on AND the chosen provider's keys are present and well formed. Pure
 * (takes the env as an argument) so it is unit tested; the server reads it through
 * `@/lib/payments`.
 *
 *   LEVELUP_ONLINE_PAYMENTS=on
 *   LEVELUP_BILLING_KEY=lu_bill_<48 hex>          (from the admin Billing screen)
 *   LEVELUP_PAYMENT_PROVIDER=stripe|square        (optional, see below)
 *
 *   Stripe:
 *   LEVELUP_STRIPE_SECRET_KEY=sk_live_…           (or sk_test_ / rk_live_ / rk_test_)
 *   LEVELUP_STRIPE_WEBHOOK_SECRET=whsec_…
 *
 *   Square:
 *   LEVELUP_SQUARE_ACCESS_TOKEN=EAAA…
 *   LEVELUP_SQUARE_LOCATION_ID=L…
 *   LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY=…
 *   LEVELUP_SQUARE_ENV=sandbox|production
 *   LEVELUP_SQUARE_WEBHOOK_URL=https://…          (optional: the subscription's URL)
 *
 * Provider: LEVELUP_PAYMENT_PROVIDER when set (its keys must be complete, otherwise
 * payments stay off; any other value keeps them off). Unset: the provider whose
 * keys are complete, Stripe when both are.
 *
 * Never NEXT_PUBLIC_: these stay on the server. Never logged.
 */

export type PaymentProviderName = 'stripe' | 'square';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** sk_live_ / rk_live_: only live-mode events are accepted (test keys: test events only). */
  livemode: boolean;
}

export interface SquareConfig {
  accessToken: string;
  locationId: string;
  webhookSignatureKey: string;
  environment: 'sandbox' | 'production';
  /** The notification URL Square signs; null = the URL the request came in on. */
  webhookUrl: string | null;
}

export interface OnlinePaymentsConfig {
  /** The provider new checkouts use. */
  provider: PaymentProviderName;
  billingKey: string;
  /** Complete keys of each provider (webhooks keep working for both). */
  stripe: StripeConfig | null;
  square: SquareConfig | null;
}

type Env = Record<string, string | undefined>;

const SECRET_KEY = /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,250}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=]{10,250}$/;
const BILLING_KEY = /^lu_bill_[0-9a-f]{48}$/;
const SQUARE_TOKEN = /^[A-Za-z0-9_-]{20,255}$/;
const SQUARE_LOCATION = /^[A-Za-z0-9]{4,64}$/;
const SQUARE_SIGNATURE_KEY = /^[A-Za-z0-9_+/=-]{10,255}$/;

const read = (env: Env, key: string) => (env[key] ?? '').trim();

export function readStripeConfig(env: Env): StripeConfig | null {
  const secretKey = read(env, 'LEVELUP_STRIPE_SECRET_KEY');
  const webhookSecret = read(env, 'LEVELUP_STRIPE_WEBHOOK_SECRET');
  if (!SECRET_KEY.test(secretKey) || !WEBHOOK_SECRET.test(webhookSecret)) return null;
  return { secretKey, webhookSecret, livemode: /^(sk|rk)_live_/.test(secretKey) };
}

function readWebhookUrl(value: string): string | null | undefined {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.search && !url.hash ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function readSquareConfig(env: Env): SquareConfig | null {
  const accessToken = read(env, 'LEVELUP_SQUARE_ACCESS_TOKEN');
  const locationId = read(env, 'LEVELUP_SQUARE_LOCATION_ID');
  const webhookSignatureKey = read(env, 'LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY');
  const environment = read(env, 'LEVELUP_SQUARE_ENV').toLowerCase();
  const webhookUrl = readWebhookUrl(read(env, 'LEVELUP_SQUARE_WEBHOOK_URL'));
  if (!SQUARE_TOKEN.test(accessToken) || !SQUARE_LOCATION.test(locationId)) return null;
  if (!SQUARE_SIGNATURE_KEY.test(webhookSignatureKey)) return null;
  if (environment !== 'sandbox' && environment !== 'production') return null;
  if (webhookUrl === undefined) return null;
  return { accessToken, locationId, webhookSignatureKey, environment, webhookUrl };
}

/** The provider for new checkouts, or null when online payments stay off. */
export function selectProvider(
  env: Env,
  stripe: StripeConfig | null,
  square: SquareConfig | null
): PaymentProviderName | null {
  const wanted = read(env, 'LEVELUP_PAYMENT_PROVIDER').toLowerCase();
  if (wanted === 'stripe') return stripe ? 'stripe' : null;
  if (wanted === 'square') return square ? 'square' : null;
  if (wanted) return null;
  return stripe ? 'stripe' : square ? 'square' : null;
}

export function readOnlinePaymentsConfig(env: Env): OnlinePaymentsConfig | null {
  if (read(env, 'LEVELUP_ONLINE_PAYMENTS').toLowerCase() !== 'on') return null;
  const billingKey = read(env, 'LEVELUP_BILLING_KEY');
  if (!BILLING_KEY.test(billingKey)) return null;
  const stripe = readStripeConfig(env);
  const square = readSquareConfig(env);
  const provider = selectProvider(env, stripe, square);
  if (!provider) return null;
  return { provider, billingKey, stripe, square };
}
