import { Icons } from '@/components/icons';

export interface PermissionCheck {
  /** Minimum organization role: viewer < editor < admin < owner */
  role?: 'viewer' | 'editor' | 'admin' | 'owner';
  /** Shown when the active website has one of these features enabled */
  feature?: string | string[];
  requireOrg?: boolean;
  requireWebsite?: boolean;
  /** LevelUp staff only */
  platformAdmin?: boolean;
}

export interface NavItem {
  /** Key of `nav.items.*` (see docs/i18n.md), or display text when `rawTitle`. */
  title: string;
  /** `title` is already translated (server-built entries such as the staff menu). */
  rawTitle?: boolean;
  url: string;
  disabled?: boolean;
  external?: boolean;
  shortcut?: [string, string];
  icon?: keyof typeof Icons;
  label?: string;
  description?: string;
  isActive?: boolean;
  items?: NavItem[];
  access?: PermissionCheck;
}

export interface NavGroup {
  /** Key of `nav.groups.*`; empty for an unlabeled group. */
  label: string;
  items: NavItem[];
}

export interface NavItemWithChildren extends NavItem {
  items: NavItemWithChildren[];
}

export interface NavItemWithOptionalChildren extends NavItem {
  items?: NavItemWithChildren[];
}

export interface FooterItem {
  title: string;
  items: {
    title: string;
    href: string;
    external?: boolean;
  }[];
}

export type MainNavItem = NavItemWithOptionalChildren;

export type SidebarNavItem = NavItemWithChildren;
