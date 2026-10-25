/**
 * Amounts are stored in the currency's minor unit (cents), like Stripe.
 * Zero-decimal currencies (JPY, KRW, …) have no minor unit.
 */
export function fractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency: currency.toUpperCase()
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** 260 usd -> 2.6 ; 500 jpy -> 500. */
export function minorToMajor(amount: number, currency: string): number {
  return amount / 10 ** fractionDigits(currency);
}

/** Options for next-intl `format.number(minorToMajor(…), moneyFormat(currency))`. */
export function moneyFormat(
  currency: string,
  compact = false
): { style: 'currency'; currency: string; notation?: 'compact'; maximumFractionDigits?: number } {
  return compact
    ? {
        style: 'currency',
        currency: currency.toUpperCase(),
        notation: 'compact',
        maximumFractionDigits: 1
      }
    : { style: 'currency', currency: currency.toUpperCase() };
}
