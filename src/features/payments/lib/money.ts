/**
 * Amounts are stored as integers in the currency's ISO 4217 minor unit,
 * whatever the payment provider: 2.60 USD = 260, 15 000 XOF = 15000 (the CFA
 * franc has no minor unit), 1.234 KWD = 1234. docs/site-api.md lists the
 * table; websites convert before reporting (e.g. a PayPal "10.00" or a
 * Flutterwave `amount: 15000` in XOF).
 *
 * The table is explicit (not `Intl`) so the server, every browser and the
 * website samples agree on the exponent.
 */

/** ISO 4217 currencies without a minor unit (exponent 0). */
export const ZERO_DECIMAL_CURRENCIES = [
  'bif',
  'clp',
  'djf',
  'gnf',
  'isk',
  'jpy',
  'kmf',
  'krw',
  'pyg',
  'rwf',
  'ugx',
  'uyi',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf'
] as const;

/** ISO 4217 currencies with three decimals (exponent 3). */
export const THREE_DECIMAL_CURRENCIES = ['bhd', 'iqd', 'jod', 'kwd', 'lyd', 'omr', 'tnd'] as const;

const EXPONENTS: Record<string, number> = {
  ...Object.fromEntries(ZERO_DECIMAL_CURRENCIES.map((c) => [c, 0])),
  ...Object.fromEntries(THREE_DECIMAL_CURRENCIES.map((c) => [c, 3])),
  clf: 4,
  uyw: 4
};

/** Number of decimals of the minor unit (2 for most currencies). */
export function fractionDigits(currency: string): number {
  return EXPONENTS[currency.toLowerCase()] ?? 2;
}

/** 260 usd -> 2.6 ; 500 jpy -> 500 ; 15000 xof -> 15000 ; 1234 kwd -> 1.234. */
export function minorToMajor(amount: number, currency: string): number {
  return amount / 10 ** fractionDigits(currency);
}

/** 2.6 usd -> 260 ; 15000 xof -> 15000 (rounded to the minor unit). */
export function majorToMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** fractionDigits(currency));
}

type MoneyFormat = {
  style: 'currency';
  currency: string;
  notation?: 'compact';
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

/** Options for next-intl `format.number(minorToMajor(…), moneyFormat(currency))`. */
export function moneyFormat(currency: string, compact = false): MoneyFormat {
  if (compact) {
    return {
      style: 'currency',
      currency: currency.toUpperCase(),
      notation: 'compact',
      maximumFractionDigits: Math.min(1, fractionDigits(currency))
    };
  }
  const digits = fractionDigits(currency);
  return {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  };
}

/** A stored amount (minor units) as text, e.g. formatMoney(15000, 'xof', 'fr') -> "15 000 F CFA". */
export function formatMoney(amount: number, currency: string, locale = 'en'): string {
  try {
    return new Intl.NumberFormat(locale, moneyFormat(currency)).format(
      minorToMajor(amount, currency)
    );
  } catch {
    // Unknown ISO code for this runtime: the number and the code.
    return `${minorToMajor(amount, currency).toFixed(fractionDigits(currency))} ${currency.toUpperCase()}`;
  }
}
