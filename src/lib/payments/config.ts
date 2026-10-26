/**
 * Online payment of LevelUp charges: switched off unless the server environment
 * turns it on AND every key is present and well formed. Pure (takes the env as an
 * argument) so it is unit tested; the server reads it through `@/lib/payments`.
 *
 *   LEVELUP_ONLINE_PAYMENTS=on
 *   LEVELUP_STRIPE_SECRET_KEY=sk_live_…      (or sk_test_ / rk_live_ / rk_test_)
 *   LEVELUP_STRIPE_WEBHOOK_SECRET=whsec_…
 *   LEVELUP_BILLING_KEY=lu_bill_<48 hex>     (from the admin Billing screen)
 *
 * Never NEXT_PUBLIC_: these stay on the server. Never logged.
 */

export interface OnlinePaymentsConfig {
  secretKey: string;
  webhookSecret: string;
  billingKey: string;
  /** sk_live_ / rk_live_: only live-mode events are accepted (test keys: test events only). */
  livemode: boolean;
}

type Env = Record<string, string | undefined>;

const SECRET_KEY = /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,250}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=]{10,250}$/;
const BILLING_KEY = /^lu_bill_[0-9a-f]{48}$/;

export function readOnlinePaymentsConfig(env: Env): OnlinePaymentsConfig | null {
  if ((env.LEVELUP_ONLINE_PAYMENTS ?? '').trim().toLowerCase() !== 'on') return null;
  const secretKey = (env.LEVELUP_STRIPE_SECRET_KEY ?? '').trim();
  const webhookSecret = (env.LEVELUP_STRIPE_WEBHOOK_SECRET ?? '').trim();
  const billingKey = (env.LEVELUP_BILLING_KEY ?? '').trim();
  if (!SECRET_KEY.test(secretKey) || !WEBHOOK_SECRET.test(webhookSecret)) return null;
  if (!BILLING_KEY.test(billingKey)) return null;
  return { secretKey, webhookSecret, billingKey, livemode: /^(sk|rk)_live_/.test(secretKey) };
}
