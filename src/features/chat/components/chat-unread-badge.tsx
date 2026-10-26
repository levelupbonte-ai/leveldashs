'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { SidebarMenuBadge } from '@/components/ui/sidebar';
import { useDashboardSession } from '@/lib/auth/session-context';
import { createClient } from '@/lib/supabase/client';
import { unreadQueryOptions } from '../api/queries';

/**
 * Unread messages of the active organization, next to "Chat" in the sidebar.
 * Polls every minute (and on focus); the chat page refreshes it live.
 */
export function ChatUnreadBadge() {
  const t = useTranslations('chat');
  const { activeOrg } = useDashboardSession();
  const db = useMemo(() => createClient(), []);
  const orgId = activeOrg?.role ? activeOrg.id : null;
  const { data: count = 0 } = useQuery({
    ...unreadQueryOptions(db, orgId ?? ''),
    enabled: !!orgId
  });
  if (!orgId || count <= 0) return null;
  return (
    <SidebarMenuBadge className='bg-primary text-primary-foreground peer-hover/menu-button:text-primary-foreground peer-data-active/menu-button:text-primary-foreground rounded-full'>
      <span aria-hidden='true'>{count > 99 ? '99+' : count}</span>
      <span className='sr-only'>{t('navBadge', { count })}</span>
    </SidebarMenuBadge>
  );
}
