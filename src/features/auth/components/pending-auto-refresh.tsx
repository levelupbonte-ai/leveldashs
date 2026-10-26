'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * The pending page checks again every 30 s while the tab is visible (and when it
 * becomes visible): once LevelUp approves the request, the server sends the
 * account to its dashboard without a manual reload.
 */
export function PendingAutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, intervalMs]);
  return null;
}
