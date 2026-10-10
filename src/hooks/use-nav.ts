'use client';

/**
 * Client-side navigation filtering (UX only).
 *
 * Visibility follows the Supabase session loaded by the /dashboard layout:
 * organization role, LevelUp platform-admin status and the features enabled
 * for the active website (`website_features`). Real enforcement is done by
 * Row Level Security in the database.
 */

import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { useDashboardSession } from '@/lib/auth/session-context';
import { hasRole, type OrgRole } from '@/lib/auth/types';
import type { NavItem, NavGroup } from '@/types';

export function useFilteredNavItems(items: NavItem[]) {
  const { activeOrg, activeWebsite, isPlatformAdmin } = useDashboardSession();

  return useMemo(() => {
    const features = new Set(activeWebsite?.features ?? []);
    const role = activeOrg?.role ?? null;

    const allowed = (item: NavItem) => {
      const access = item.access;
      if (!access) return true;
      if (access.platformAdmin && !isPlatformAdmin) return false;
      if (access.requireOrg && !activeOrg) return false;
      if (access.requireWebsite && !activeWebsite) return false;
      if (access.role && !(isPlatformAdmin || hasRole(role, access.role as OrgRole))) return false;
      if (access.feature) {
        const keys = Array.isArray(access.feature) ? access.feature : [access.feature];
        if (!keys.some((k) => features.has(k))) return false;
      }
      return true;
    };

    return items
      .filter(allowed)
      .map((item) =>
        item.items && item.items.length > 0 ? { ...item, items: item.items.filter(allowed) } : item
      );
  }, [items, activeOrg, activeWebsite, isPlatformAdmin]);
}

export function useFilteredNavGroups(groups: NavGroup[]) {
  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const filteredItems = useFilteredNavItems(allItems);

  return useMemo(() => {
    const filteredSet = new Set(filteredItems.map((item) => item.title));
    return groups
      .map((group) => ({
        ...group,
        items: filteredItems.filter((item) =>
          group.items.some((gi) => gi.title === item.title && filteredSet.has(gi.title))
        )
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, filteredItems]);
}

/** Display text of a nav item (`nav.items.<title>`, or the title itself when `rawTitle`). */
export function useNavTitle() {
  const t = useTranslations('nav');
  return useCallback(
    (item: Pick<NavItem, 'title' | 'rawTitle'>) =>
      item.rawTitle ? item.title : t(`items.${item.title}` as Parameters<typeof t>[0]),
    [t]
  );
}

/** Display text of a nav group label (`nav.groups.<label>`). */
export function useNavGroupLabel() {
  const t = useTranslations('nav');
  return useCallback(
    (label: string) => (label ? t(`groups.${label}` as Parameters<typeof t>[0]) : ''),
    [t]
  );
}

/** The client navigation plus the server-built staff group (platform admins only). */
export function useNavGroups(base: NavGroup[], extra?: NavGroup | null) {
  return useMemo(() => {
    if (!extra) return base;
    // Staff entries sit right before the last (account) group.
    return [...base.slice(0, -1), extra, ...base.slice(-1)];
  }, [base, extra]);
}
