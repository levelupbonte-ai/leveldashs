'use client';

import { Icons } from '@/components/icons';
import { setActiveOrganization, setActiveWebsite } from '@/lib/auth/actions';
import { useDashboardSession } from '@/lib/auth/session-context';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '@/components/ui/sidebar';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  editor: 'Éditeur',
  viewer: 'Lecture seule'
};

export function OrgSwitcher() {
  const { isMobile, state } = useSidebar();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { organizations, activeOrg, websites, activeWebsite, isPlatformAdmin } =
    useDashboardSession();

  const run = (action: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch {
        toast.error('Changement impossible.');
      }
    });

  const collapsedClass =
    state === 'collapsed'
      ? 'invisible max-w-0 overflow-hidden opacity-0'
      : 'visible max-w-full opacity-100';

  if (!activeOrg) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size='lg' onClick={() => router.push('/dashboard/workspaces')}>
            <div className='flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10'>
              <Icons.logo className='size-5' />
            </div>
            <div
              className={`grid flex-1 text-left text-sm leading-tight transition-all duration-200 ${collapsedClass}`}
            >
              <span className='truncate font-medium'>Aucune organisation</span>
              <span className='text-muted-foreground truncate text-xs'>Commencer</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const subtitle = activeWebsite
    ? activeWebsite.primaryDomain || activeWebsite.name
    : activeOrg.role
      ? ROLE_LABEL[activeOrg.role]
      : 'LevelUp admin';

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={pending}
            render={
              <SidebarMenuButton
                size='lg'
                className='data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground'
              />
            }
          >
            <div className='flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-violet-500/20 bg-violet-500/10'>
              {pending ? (
                <Icons.spinner className='size-4 animate-spin' />
              ) : activeOrg.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeOrg.logoUrl} alt='' className='size-full bg-white object-contain' />
              ) : (
                <Icons.logo className='size-5' />
              )}
            </div>
            <div
              className={`grid flex-1 text-left text-sm leading-tight transition-all duration-200 ease-in-out ${collapsedClass}`}
            >
              <span className='truncate font-medium'>{activeOrg.name}</span>
              <span className='text-muted-foreground truncate text-xs'>{subtitle}</span>
            </div>
            <Icons.chevronsUpDown
              className={`ml-auto transition-all duration-200 ease-in-out ${collapsedClass}`}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-(--anchor-width) min-w-64 rounded-lg'
            align='start'
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            {websites.length > 1 && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel className='text-muted-foreground text-xs'>
                    Sites
                  </DropdownMenuLabel>
                  {websites.map((site) => (
                    <DropdownMenuItem
                      key={site.id}
                      onClick={() =>
                        site.id !== activeWebsite?.id && run(() => setActiveWebsite(site.id))
                      }
                      className='gap-2 p-2'
                    >
                      <Icons.world className='size-4 shrink-0' />
                      <span className='truncate'>{site.primaryDomain || site.name}</span>
                      {site.id === activeWebsite?.id && <Icons.check className='ml-auto size-4' />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuGroup>
              <DropdownMenuLabel className='text-muted-foreground text-xs'>
                {isPlatformAdmin ? 'Organisations (admin LevelUp)' : 'Organisations'}
              </DropdownMenuLabel>
              {organizations.map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  onClick={() =>
                    org.id !== activeOrg.id && run(() => setActiveOrganization(org.id))
                  }
                  className='gap-2 p-2'
                >
                  <div className='flex size-6 items-center justify-center overflow-hidden rounded-md border'>
                    {org.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={org.logoUrl} alt='' className='size-full bg-white object-contain' />
                    ) : (
                      <Icons.logo className='size-4 shrink-0' />
                    )}
                  </div>
                  <span className='truncate'>{org.name}</span>
                  {org.id === activeOrg.id && <Icons.check className='ml-auto size-4' />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className='gap-2 p-2'
                onClick={() => router.push('/dashboard/workspaces')}
              >
                <div className='flex size-6 items-center justify-center rounded-md border bg-transparent'>
                  <Icons.add className='size-4' />
                </div>
                <div className='text-muted-foreground font-medium'>Gérer les organisations</div>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
