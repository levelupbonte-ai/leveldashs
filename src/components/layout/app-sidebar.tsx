'use client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail
} from '@/components/ui/sidebar';
import { UserAvatarProfile } from '@/components/user-avatar-profile';
import { navGroups } from '@/config/nav-config';
import { ChatUnreadBadge } from '@/features/chat/components/chat-unread-badge';
import { useMediaQuery } from '@/hooks/use-media-query';
import { signOut } from '@/lib/auth/actions';
import { useDashboardSession } from '@/lib/auth/session-context';
import { hasRole } from '@/lib/auth/types';
import { useFilteredNavGroups, useNavGroupLabel, useNavGroups, useNavTitle } from '@/hooks/use-nav';
import { LocaleMenuSub } from '@/components/i18n/locale-switcher';
import { LegalMenuSub } from '@/components/legal-menu-sub';
import type { NavGroup } from '@/types';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { Icons } from '../icons';
import { OrgSwitcher } from '../org-switcher';

export default function AppSidebar({ adminNav }: { adminNav?: NavGroup | null }) {
  const pathname = usePathname();
  const { isOpen } = useMediaQuery();
  const { user, activeOrg: organization, isPlatformAdmin } = useDashboardSession();
  // Billing: owners and admins (members see their plan from the page, not the menu).
  const showBilling = !!organization && (isPlatformAdmin || hasRole(organization.role, 'admin'));
  const router = useRouter();
  const groups = useNavGroups(navGroups, adminNav);
  const filteredGroups = useFilteredNavGroups(groups);
  const navTitle = useNavTitle();
  const groupLabel = useNavGroupLabel();
  const t = useTranslations('common.userMenu');

  React.useEffect(() => {
    // Side effects based on sidebar state changes
  }, [isOpen]);

  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader className='group-data-[collapsible=icon]:pt-4'>
        <OrgSwitcher />
      </SidebarHeader>
      <SidebarContent className='overflow-x-hidden'>
        {filteredGroups.map((group, index) => (
          // Several groups have no label (staff menu, account): the index keeps keys unique.
          <SidebarGroup key={group.label || `ungrouped-${index}`} className='py-0'>
            {group.label && <SidebarGroupLabel>{groupLabel(group.label)}</SidebarGroupLabel>}
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = item.icon ? Icons[item.icon] : Icons.logo;
                return item?.items && item?.items?.length > 0 ? (
                  <Collapsible
                    key={item.title}
                    defaultOpen={item.isActive}
                    render={<SidebarMenuItem />}
                  >
                    <CollapsibleTrigger
                      render={
                        <SidebarMenuButton
                          tooltip={navTitle(item)}
                          isActive={pathname === item.url}
                          className='group/collapsible'
                        />
                      }
                    >
                      {item.icon && <Icon />}
                      <span>{navTitle(item)}</span>
                      <Icons.chevronRight className='ml-auto transition-transform duration-200 group-data-panel-open/collapsible:rotate-90' />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items?.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.title}>
                            <SidebarMenuSubButton
                              render={<Link href={subItem.url} aria-label={navTitle(subItem)} />}
                              isActive={pathname === subItem.url}
                            >
                              <span>{navTitle(subItem)}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                ) : (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      render={<Link href={item.url} aria-label={navTitle(item)} />}
                      tooltip={navTitle(item)}
                      isActive={pathname === item.url}
                    >
                      <Icon />
                      <span>{navTitle(item)}</span>
                    </SidebarMenuButton>
                    {item.badge === 'chatUnread' && <ChatUnreadBadge />}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size='lg'
                    className='data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground'
                  />
                }
              >
                {user && <UserAvatarProfile className='h-8 w-8 rounded-lg' showInfo user={user} />}
                <Icons.chevronsDown className='ml-auto size-4' />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className='w-(--anchor-width) min-w-56 rounded-lg'
                side='bottom'
                align='end'
                sideOffset={4}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className='p-0 font-normal'>
                    <div className='px-1 py-1.5'>
                      {user && (
                        <UserAvatarProfile className='h-8 w-8 rounded-lg' showInfo user={user} />
                      )}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />

                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => router.push('/dashboard/profile')}>
                    <Icons.account className='mr-2 h-4 w-4' />
                    {t('profile')}
                  </DropdownMenuItem>
                  {showBilling && (
                    <DropdownMenuItem onClick={() => router.push('/dashboard/billing')}>
                      <Icons.creditCard className='mr-2 h-4 w-4' />
                      {t('billing')}
                    </DropdownMenuItem>
                  )}
                  <LocaleMenuSub />
                  <LegalMenuSub />
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => void signOut()}>
                    <Icons.logout aria-hidden className='mr-2 h-4 w-4' />
                    {t('signOut')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
