import { fractionDigits, minorToMajor, moneyFormat } from '@/features/payments/lib/money';

type NumberFormatter = (value: number, options: ReturnType<typeof moneyFormat>) => string;

/** Minor units (cents) to the localized amount: 1999 usd -> "$19.99". */
export function formatMoney(format: NumberFormatter, amount: number, currency: string): string {
  return format(minorToMajor(amount, currency), moneyFormat(currency));
}

/** A typed major amount ("19.99") to minor units (1999); null when empty or not a number. */
export function majorToMinor(value: number | string | undefined | null, currency: string) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10 ** fractionDigits(currency));
}

/** Minor units back to the number shown in an amount field (1999 usd -> 19.99). */
export function minorToField(amount: number | null | undefined, currency: string) {
  return amount === null || amount === undefined ? undefined : minorToMajor(amount, currency);
}

/** Bytes as MB below 1 GB, GB above (1 decimal): the unit people know. */
export function storageParts(bytes: number): {
  value: number;
  unit: 'MB' | 'GB';
} {
  const mb = bytes / 1048576;
  return mb >= 1024
    ? { value: Math.round((mb / 1024) * 10) / 10, unit: 'GB' }
    : { value: Math.round(mb * 10) / 10, unit: 'MB' };
}

/** Meter state of a plan limit: ok, near (80 % and up) or reached. */
export function meterState(used: number, limit: number | null): 'ok' | 'near' | 'reached' {
  if (limit === null) return 'ok';
  if (limit === 0 || used >= limit) return 'reached';
  return used / limit >= 0.8 ? 'near' : 'ok';
}

/** Percent of a limit used, 0..100 (0 when unlimited). */
export function meterPercent(used: number, limit: number | null): number {
  if (limit === null) return 0;
  if (limit === 0) return 100;
  return Math.min(100, Math.round((used / limit) * 100));
}

export const CURRENCY_RE = /^[A-Za-z]{3}$/;
export const PROMO_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/;
