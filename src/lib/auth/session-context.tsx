'use client';
import { createContext, useContext } from 'react';
import type { DashboardSession } from './types';

const SessionContext = createContext<DashboardSession | null>(null);

export function SessionProvider({
  session,
  children
}: {
  session: DashboardSession;
  children: React.ReactNode;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useDashboardSession(): DashboardSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useDashboardSession must be used inside /dashboard');
  return session;
}

/** The active website, or null when the organization has none yet. */
export function useActiveWebsite() {
  return useDashboardSession().activeWebsite;
}
