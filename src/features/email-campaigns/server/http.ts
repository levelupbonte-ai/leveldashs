import 'server-only';
import { NextResponse } from 'next/server';
import { PlanLimitError } from '@/lib/plan-limit';
import { campaignError } from '../api/service';

/** A database refusal as a short JSON error code (never the database message). */
export function dbErrorResponse(error: {
  message: string;
  code?: string;
  details?: string | null;
}) {
  const appError = campaignError(error, 'emailSendFailed');
  const status =
    appError.code === 'forbidden' || appError.code === 'mfaRequired'
      ? 403
      : appError.code === 'rateLimited' || appError.code === 'dailyCapReached'
        ? 429
        : appError.code === 'planLimitReached'
          ? 402
          : 400;
  return NextResponse.json(
    appError instanceof PlanLimitError
      ? { error: appError.code, limit: appError.info }
      : { error: appError.code },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export const noStore = { 'Cache-Control': 'no-store' };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
