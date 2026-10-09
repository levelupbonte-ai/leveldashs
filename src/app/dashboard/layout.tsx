import KBar from '@/components/kbar';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { InfoSidebar } from '@/components/layout/info-sidebar';
import { MfaRequiredBanner } from '@/components/layout/mfa-required-banner';
import { InfobarProvider } from '@/components/ui/infobar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { RecordLastMethod } from '@/features/auth/components/record-last-method';
import { getAccessState, noAccessPath } from '@/lib/auth/access';
import { requireDashboardSession } from '@/lib/auth/session';
import { SessionProvider } from '@/lib/auth/session-context';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'LevelUp Ecosystem client dashboard',
  robots: {
    index: false,
    follow: false
  }
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Gate the whole /dashboard segment: redirect to sign-in when signed out.
  const session = await requireDashboardSession();
  // The dashboard is for LevelUp clients: members of an organization (invited
  // people join automatically) or LevelUp staff. Everyone else finishes their
  // profile and asks for access first; a submitted (or rejected) request goes
  // straight to its status page, whatever the sign-in method.
  const access = await getAccessState(session);
  if (access !== 'member') redirect(noAccessPath(access));
  // Persisting the sidebar state in the cookie.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value === 'true';
  return (
    <SessionProvider session={session}>
      <RecordLastMethod />
      <KBar>
        <SidebarProvider defaultOpen={defaultOpen}>
          <a
            href='#main-content'
            className='bg-background ring-ring sr-only rounded-md px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:ring-2'
          >
            Skip to content
          </a>
          <AppSidebar />
          <SidebarInset id='main-content' tabIndex={-1} className='min-w-0 scroll-mt-16'>
            <Header />
            <MfaRequiredBanner />
            <InfobarProvider defaultOpen={false} className='min-w-0'>
              {children}
              <InfoSidebar side='right' />
            </InfobarProvider>
          </SidebarInset>
        </SidebarProvider>
      </KBar>
    </SessionProvider>
  );
}
