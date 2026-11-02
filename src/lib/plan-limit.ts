import { AppError } from '@/lib/errors';

/** Limit keys of the plans (same list as private.billing_limit_keys in the database). */
export type PlanLimitKey =
  | 'team_members'
  | 'assistant_requests_month'
  | 'media_mb'
  | 'websites'
  | 'emails_month';
const KEYS: readonly string[] = [
  'team_members',
  'assistant_requests_month',
  'media_mb',
  'websites',
  'emails_month'
];

export interface PlanLimitInfo {
  key: PlanLimitKey;
  limit: number;
}

/**
 * The organization's plan does not allow one more of `key`. Shown with
 * `PlanLimitNotice` (features/billing): "Your plan allows N … Upgrade to do more."
 */
export class PlanLimitError extends AppError {
  readonly info: PlanLimitInfo;

  constructor(info: PlanLimitInfo, options?: { cause?: unknown }) {
    super('planLimitReached', options);
    this.name = 'PlanLimitError';
    this.info = info;
  }
}

/** A value that may describe a plan limit (route handler body or database detail). */
export function parsePlanLimit(value: unknown): PlanLimitInfo | null {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const { key, limit } = v as { key?: unknown; limit?: unknown };
  if (typeof key !== 'string' || !KEYS.includes(key)) return null;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) return null;
  return { key: key as PlanLimitKey, limit };
}

/**
 * The database raised `plan_limit_reached` (errcode PT402); its detail is
 * `{"key", "limit", "plan"}`. Null for any other error.
 */
export function planLimitFromDb(
  error: { message?: string; code?: string; details?: string | null } | null | undefined
): PlanLimitInfo | null {
  if (!error || error.message !== 'plan_limit_reached') return null;
  return parsePlanLimit(error.details ?? null);
}
