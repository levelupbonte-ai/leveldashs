'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useDashboardSession } from '@/lib/auth/session-context';
import { CONTRACT_PATH, isAllowedWhileLocked } from '@/lib/auth/types';

/**
 * Client side of the contract gate. The proxy already redirects every request
 * (src/lib/supabase/proxy.ts); this covers pages served from the client router
 * cache (back/forward) while the organization is locked. Staff are never locked.
 */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const { access, isPlatformAdmin } = useDashboardSession();
  const pathname = usePathname();
  const router = useRouter();
  const blocked = !isPlatformAdmin && access.state !== 'active' && !isAllowedWhileLocked(pathname);

  useEffect(() => {
    if (blocked) router.replace(CONTRACT_PATH);
  }, [blocked, router]);

  return blocked ? null : children;
}
