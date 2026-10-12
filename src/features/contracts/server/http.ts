import 'server-only';
import type { NextRequest } from 'next/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string) => UUID.test(value);

/** State-changing calls must come from this dashboard (Origin = Host). */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  try {
    return !!origin && new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

export const DASHBOARD_URL = 'https://dashboard.levelup-ecosystem.com';
export const LEVELUP_CONTACT = 'contact@levelup-ecosystem.com';
