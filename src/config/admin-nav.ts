import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { NavGroup } from '@/types';

/**
 * LevelUp staff navigation. Built on the server for platform admins only and
 * passed to the sidebar / Cmd+K as props, so the entries (and their wording)
 * never reach the browser of a client account.
 */
export async function getAdminNavGroup(): Promise<NavGroup> {
  const t = await getTranslations('admin.nav');
  return {
    label: '',
    items: [
      {
        title: t('levelupAdmin'),
        rawTitle: true,
        url: '#',
        icon: 'pro',
        isActive: false,
        items: [
          {
            title: t('allClients'),
            rawTitle: true,
            url: '/dashboard/exclusive',
            icon: 'exclusive',
            shortcut: ['e', 'e']
          }
        ]
      }
    ]
  };
}
