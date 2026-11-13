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
 *   PayPal (offered beside the card provider, or alone):
 *   LEVELUP_PAYPAL_CLIENT_ID=…
 *   LEVELUP_PAYPAL_CLIENT_SECRET=…
 *   LEVELUP_PAYPAL_WEBHOOK_ID=…                    (the webhook's id in the PayPal app)
 *   LEVELUP_PAYPAL_ENV=sandbox|production
 *
 * Provider: LEVELUP_PAYMENT_PROVIDER when set (its keys must be complete, otherwise
 * payments stay off; any other value keeps them off). Unset: the provider whose
 * keys are complete, Stripe when both are.
 *
 * Never NEXT_PUBLIC_: these stay on the server. Never logged.
 */

export type PaymentProviderName = 'stripe' | 'square' | 'paypal';

/** What the payer picks: a card (Stripe or Square, whichever is set up) or PayPal. */
export type PaymentMethodChoice = 'card' | 'paypal';

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  environment: 'sandbox' | 'production';
}

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
  /** The provider new checkouts use by default (the card provider, else PayPal). */
  provider: PaymentProviderName;
  /** The card provider (Stripe or Square), or null when only PayPal is set up. */
  cardProvider: 'stripe' | 'square' | null;
  /** What the payer can choose, card first. */
  methods: PaymentMethodChoice[];
  billingKey: string;
  /** Complete keys of each provider (webhooks keep working for both). */
  stripe: StripeConfig | null;
  square: SquareConfig | null;
  paypal: PayPalConfig | null;
}

type Env = Record<string, string | undefined>;

const SECRET_KEY = /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,250}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=]{10,250}$/;
const BILLING_KEY = /^lu_bill_[0-9a-f]{48}$/;
const SQUARE_TOKEN = /^[A-Za-z0-9_-]{20,255}$/;
const SQUARE_LOCATION = /^[A-Za-z0-9]{4,64}$/;
const SQUARE_SIGNATURE_KEY = /^[A-Za-z0-9_+/=-]{10,255}$/;
const PAYPAL_CLIENT = /^[A-Za-z0-9_-]{20,128}$/;
const PAYPAL_WEBHOOK_ID = /^[A-Z0-9]{8,64}$/;

/**
 * A value as pasted in the Vercel screen: trimmed, without surrounding quotes
 * and without a leading "Bearer " (copied from an API example).
 */
const read = (env: Env, key: string) => {
  let v = (env[key] ?? '').trim();
  while (v.length >= 2 && /^(["'`])[^]*\1$/.test(v)) v = v.slice(1, -1).trim();
  return v.replace(/^Bearer\s+/i, '').trim();
};

/** LevelUp's server key (billing key), also used by background workers such as the news. */
export function readBillingKey(env: Env): string | null {
  const key = read(env, 'LEVELUP_BILLING_KEY');
  return BILLING_KEY.test(key) ? key : null;
}

/** on / true / 1 / yes / oui (any case). */
const isOn = (value: string) => ['on', 'true', '1', 'yes', 'oui'].includes(value.toLowerCase());

/** sandbox / production, with the usual synonyms (live, prod, test). */
function readEnvironment(value: string): 'sandbox' | 'production' | null {
  const v = value.toLowerCase();
  if (['production', 'prod', 'live'].includes(v)) return 'production';
  if (['sandbox', 'test'].includes(v)) return 'sandbox';
  return null;
}

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
  const environment = readEnvironment(read(env, 'LEVELUP_SQUARE_ENV'));
  const webhookUrl = readWebhookUrl(read(env, 'LEVELUP_SQUARE_WEBHOOK_URL'));
  if (!SQUARE_TOKEN.test(accessToken) || !SQUARE_LOCATION.test(locationId)) return null;
  if (!SQUARE_SIGNATURE_KEY.test(webhookSignatureKey)) return null;
  if (!environment) return null;
  if (webhookUrl === undefined) return null;
  return { accessToken, locationId, webhookSignatureKey, environment, webhookUrl };
}

export function readPayPalConfig(env: Env): PayPalConfig | null {
  const clientId = read(env, 'LEVELUP_PAYPAL_CLIENT_ID');
  const clientSecret = read(env, 'LEVELUP_PAYPAL_CLIENT_SECRET');
  const webhookId = read(env, 'LEVELUP_PAYPAL_WEBHOOK_ID');
  const environment = readEnvironment(read(env, 'LEVELUP_PAYPAL_ENV'));
  if (!PAYPAL_CLIENT.test(clientId) || !PAYPAL_CLIENT.test(clientSecret)) return null;
  if (!PAYPAL_WEBHOOK_ID.test(webhookId)) return null;
  if (!environment) return null;
  return { clientId, clientSecret, webhookId, environment };
}

/** The card provider for new checkouts, or null when none is set up. */
export function selectProvider(
  env: Env,
  stripe: StripeConfig | null,
  square: SquareConfig | null
): 'stripe' | 'square' | null {
  const wanted = read(env, 'LEVELUP_PAYMENT_PROVIDER').toLowerCase();
  if (wanted === 'stripe') return stripe ? 'stripe' : null;
  if (wanted === 'square') return square ? 'square' : null;
  if (wanted) return null;
  return stripe ? 'stripe' : square ? 'square' : null;
}

export function readOnlinePaymentsConfig(env: Env): OnlinePaymentsConfig | null {
  if (!isOn(read(env, 'LEVELUP_ONLINE_PAYMENTS'))) return null;
  const billingKey = read(env, 'LEVELUP_BILLING_KEY');
  if (!BILLING_KEY.test(billingKey)) return null;
  const stripe = readStripeConfig(env);
  const square = readSquareConfig(env);
  const paypal = readPayPalConfig(env);
  const wanted = read(env, 'LEVELUP_PAYMENT_PROVIDER').toLowerCase();
  // LEVELUP_PAYMENT_PROVIDER names the card provider; 'paypal' means PayPal only.
  const cardProvider = wanted === 'paypal' ? null : selectProvider(env, stripe, square);
  if (wanted && wanted !== 'paypal' && !cardProvider) return null;
  const methods: PaymentMethodChoice[] = [];
  if (cardProvider) methods.push('card');
  if (paypal) methods.push('paypal');
  if (!methods.length) return null;
  return {
    provider: cardProvider ?? 'paypal',
    cardProvider,
    methods,
    billingKey,
    stripe,
    square,
    paypal
  };
}

/**
 * Why online payments are off: the names of the variables that are missing or
 * malformed (never their values), for the server log. Empty when they are on.
 */
export function diagnoseOnlinePayments(env: Env): string[] {
  if (readOnlinePaymentsConfig(env)) return [];
  const problems: string[] = [];
  const check = (key: string, ok: boolean) => {
    if (!ok) problems.push(read(env, key) ? `${key} (malformed)` : `${key} (missing)`);
  };
  check('LEVELUP_ONLINE_PAYMENTS', isOn(read(env, 'LEVELUP_ONLINE_PAYMENTS')));
  check('LEVELUP_BILLING_KEY', BILLING_KEY.test(read(env, 'LEVELUP_BILLING_KEY')));
  const wanted = read(env, 'LEVELUP_PAYMENT_PROVIDER').toLowerCase();
  check('LEVELUP_PAYMENT_PROVIDER', ['', 'stripe', 'square', 'paypal'].includes(wanted));
  if (wanted === 'square' || (!wanted && !readStripeConfig(env))) {
    check(
      'LEVELUP_SQUARE_ACCESS_TOKEN',
      SQUARE_TOKEN.test(read(env, 'LEVELUP_SQUARE_ACCESS_TOKEN'))
    );
    check(
      'LEVELUP_SQUARE_LOCATION_ID',
      SQUARE_LOCATION.test(read(env, 'LEVELUP_SQUARE_LOCATION_ID'))
    );
    check(
      'LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY',
      SQUARE_SIGNATURE_KEY.test(read(env, 'LEVELUP_SQUARE_WEBHOOK_SIGNATURE_KEY'))
    );
    check('LEVELUP_SQUARE_ENV', readEnvironment(read(env, 'LEVELUP_SQUARE_ENV')) !== null);
    const url = read(env, 'LEVELUP_SQUARE_WEBHOOK_URL');
    if (url) check('LEVELUP_SQUARE_WEBHOOK_URL', readWebhookUrl(url) !== undefined);
  }
  if (wanted === 'stripe') {
    check('LEVELUP_STRIPE_SECRET_KEY', SECRET_KEY.test(read(env, 'LEVELUP_STRIPE_SECRET_KEY')));
    check(
      'LEVELUP_STRIPE_WEBHOOK_SECRET',
      WEBHOOK_SECRET.test(read(env, 'LEVELUP_STRIPE_WEBHOOK_SECRET'))
    );
  }
  return problems.length ? problems : ['incomplete provider keys'];
}
