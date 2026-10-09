import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { DashboardSession } from './types';

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

export interface AccessRequest {
  status: AccessRequestStatus;
  businessName: string;
  website: string;
  phone: string;
  message: string;
  createdAt: string | null;
}

/** Where a signed-in account stands with the dashboard. */
export type AccessState = 'member' | 'pending' | 'rejected' | 'onboarding';

export const PENDING_PATH = '/auth/pending';
export const ONBOARDING_PATH = '/auth/onboarding';

/** Members of an organization and LevelUp staff open the dashboard. */
export function hasDashboardAccess(session: DashboardSession): boolean {
  return session.isPlatformAdmin || session.organizations.length > 0;
}

/** The user's own access request (RLS: only their row), cached per request. */
export const getAccessRequest = cache(async (userId: string): Promise<AccessRequest | null> => {
  const db = await createClient();
  const { data } = await db
    .from('access_requests')
    .select('status, business_name, website, phone, message, created_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  return {
    status: data.status as AccessRequestStatus,
    businessName: data.business_name ?? '',
    website: data.website ?? '',
    phone: data.phone ?? '',
    message: data.message ?? '',
    createdAt: data.created_at ?? null
  };
});

export async function getAccessState(session: DashboardSession): Promise<AccessState> {
  if (hasDashboardAccess(session)) return 'member';
  const request = await getAccessRequest(session.user.id);
  if (request?.status === 'pending') return 'pending';
  if (request?.status === 'rejected') return 'rejected';
  return 'onboarding';
}

/** Page an account without dashboard access belongs on. */
export function noAccessPath(state: Exclude<AccessState, 'member'>): string {
  return state === 'onboarding' ? ONBOARDING_PATH : PENDING_PATH;
}
