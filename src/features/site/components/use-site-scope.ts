'use client';
import { useDashboardSession } from '@/lib/auth/session-context';
import { hasRole } from '@/lib/auth/types';

/** Active website scope + what the current user may do on it (UI only; RLS enforces). */
export function useSiteScope() {
  const { activeOrg, activeWebsite, isPlatformAdmin } = useDashboardSession();
  if (!activeOrg || !activeWebsite) throw new Error('No active website');
  const role = activeOrg.role;
  return {
    websiteId: activeWebsite.id,
    organizationId: activeOrg.id,
    website: activeWebsite,
    canEdit: isPlatformAdmin || hasRole(role, 'editor'),
    canAdmin: isPlatformAdmin || hasRole(role, 'admin')
  };
}
