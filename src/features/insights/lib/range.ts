import { parseAsNumberLiteral } from 'nuqs/server';
import { RANGE_DAYS, type RangeDays } from '../api/types';

export const DEFAULT_RANGE: RangeDays = 30;

/**
 * `?range=7|30|90`, shared by the server cache (`src/lib/searchparams.ts`) and
 * the client (`useQueryStates`), so both build the same query key.
 */
export const rangeParser = parseAsNumberLiteral(RANGE_DAYS).withDefault(DEFAULT_RANGE);

/** Percentage change, or null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Every day of the range (oldest first) with the value of `rows` for that day,
 * 0 when missing, so charts never skip empty days.
 */
export function fillDays<T extends { day: string }>(
  from: string,
  to: string,
  rows: T[],
  pick: (row: T | undefined, day: string) => Record<string, number>
): ({ day: string } & Record<string, number | string>)[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: ({ day: string } & Record<string, number | string>)[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = start; d <= end && out.length < 400; d = new Date(d.getTime() + 86400000)) {
    const day = d.toISOString().slice(0, 10);
    out.push({ day, ...pick(byDay.get(day), day) });
  }
  return out;
}
