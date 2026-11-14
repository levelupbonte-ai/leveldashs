'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { SidebarMenuBadge } from '@/components/ui/sidebar';
import { portalInboxQueryOptions } from '@/features/client-portal/api/queries';
import { useDashboardSession } from '@/lib/auth/session-context';
import { hasRole } from '@/lib/auth/types';
import { createClient } from '@/lib/supabase/client';
import { unreadQueryOptions } from '../api/queries';

/**
 * Unread messages of the active organization, next to "Chat" in the sidebar,
 * plus the unread messages of the client-portal members (Black Pater…), which
 * the team also answers from the chat page. Polls (and refreshes on focus).
 */
export function ChatUnreadBadge() {
  const t = useTranslations('chat');
  const { activeOrg, activeWebsite } = useDashboardSession();
  const db = useMemo(() => createClient(), []);
  const orgId = activeOrg?.role ? activeOrg.id : null;
  const { data: chatCount = 0 } = useQuery({
    ...unreadQueryOptions(db, orgId ?? ''),
    enabled: !!orgId
  });
  const portalSite =
    activeOrg?.role &&
    hasRole(activeOrg.role, 'editor') &&
    activeWebsite?.features.includes('client_portal')
      ? activeWebsite.id
      : null;
  const { data: members } = useQuery({
    ...portalInboxQueryOptions(db, portalSite ?? ''),
    enabled: !!portalSite
  });
  const count = chatCount + (members ?? []).reduce((n, m) => n + m.unread, 0);
  if (!orgId || count <= 0) return null;
  return (
    <SidebarMenuBadge className='bg-primary text-primary-foreground peer-hover/menu-button:text-primary-foreground peer-data-active/menu-button:text-primary-foreground rounded-full'>
      <span aria-hidden='true'>{count > 99 ? '99+' : count}</span>
      <span className='sr-only'>{t('navBadge', { count })}</span>
    </SidebarMenuBadge>
  );
}
