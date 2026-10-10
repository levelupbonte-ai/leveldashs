import { NavGroup } from '@/types';

/**
 * Navigation configuration with RBAC support
 *
 * Used by the sidebar and the Cmd+K bar. `access` controls visibility (UX only;
 * Row Level Security enforces the real rules):
 *
 * - `requireOrg` / `requireWebsite`: an active organization / website is needed
 * - `role`: minimum organization role (viewer < editor < admin < owner)
 * - `feature`: website_features key(s) that must be enabled on the active website
 * - `platformAdmin`: LevelUp staff only
 *
 * `label` / `title` are keys of the `nav.groups` / `nav.items` messages (see
 * docs/i18n.md). LevelUp staff entries are not here: they come from
 * `src/config/admin-nav.ts` (server-only), so client bundles never list them.
 */
export const navGroups: NavGroup[] = [
  {
    label: 'mySite',
    items: [
      {
        title: 'siteOverview',
        url: '/dashboard/site',
        icon: 'world',
        isActive: false,
        shortcut: ['s', 's'],
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'assistant',
        url: '/dashboard/site/assistant',
        icon: 'sparkles',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'appointments',
        url: '/dashboard/site/appointments',
        icon: 'calendar',
        isActive: false,
        items: [],
        access: { requireWebsite: true, feature: 'bookings' }
      },
      {
        title: 'waitlist',
        url: '/dashboard/site/waitlist',
        icon: 'hourglass',
        isActive: false,
        items: [],
        access: { requireWebsite: true, feature: 'waitlist' }
      },
      {
        title: 'requests',
        url: '/dashboard/site/requests',
        icon: 'inbox',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'content',
        url: '#',
        icon: 'listDetails',
        isActive: true,
        access: { requireWebsite: true },
        items: [
          {
            title: 'services',
            url: '/dashboard/site/services',
            icon: 'scissors',
            access: { feature: 'services' }
          },
          {
            title: 'team',
            url: '/dashboard/site/team',
            icon: 'teams',
            access: { feature: 'team' }
          },
          {
            title: 'gallery',
            url: '/dashboard/site/gallery',
            icon: 'photo',
            access: { feature: 'gallery' }
          },
          {
            title: 'reviews',
            url: '/dashboard/site/reviews',
            icon: 'star',
            access: { feature: 'reviews' }
          },
          {
            title: 'announcements',
            url: '/dashboard/site/announcements',
            icon: 'speakerphone',
            access: { feature: ['announcements', 'promotions', 'blog'] }
          },
          { title: 'faq', url: '/dashboard/site/faq', icon: 'help' }
        ]
      },
      {
        title: 'media',
        url: '/dashboard/site/media',
        icon: 'photo',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'seo',
        url: '/dashboard/site/seo',
        icon: 'trendingUp',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'developers',
        url: '/dashboard/site/developers',
        icon: 'code',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'siteSettings',
        url: '/dashboard/site/settings',
        icon: 'settings',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
      }
    ]
  },
  {
    label: 'overview',
    items: [
      {
        title: 'dashboard',
        url: '/dashboard/overview',
        icon: 'dashboard',
        isActive: false,
        shortcut: ['d', 'd'],
        items: []
      },
      {
        title: 'organizations',
        url: '/dashboard/workspaces',
        icon: 'workspace',
        isActive: false,
        items: []
      },
      {
        title: 'teamAccess',
        url: '/dashboard/workspaces/team',
        icon: 'teams',
        isActive: false,
        items: [],
        access: { requireOrg: true }
      },
      {
        title: 'product',
        url: '/dashboard/product',
        icon: 'product',
        shortcut: ['p', 'p'],
        isActive: false,
        items: []
      },
      {
        title: 'users',
        url: '/dashboard/users',
        icon: 'teams',
        shortcut: ['u', 'u'],
        isActive: false,
        items: []
      },
      {
        title: 'kanban',
        url: '/dashboard/kanban',
        icon: 'kanban',
        shortcut: ['k', 'k'],
        isActive: false,
        items: []
      },
      {
        title: 'chat',
        url: '/dashboard/chat',
        icon: 'chat',
        shortcut: ['c', 'c'],
        isActive: false,
        items: []
      },
      {
        title: 'aiChat',
        url: '/dashboard/ai-chat',
        icon: 'sparkles',
        shortcut: ['a', 'i'],
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'elements',
    items: [
      {
        title: 'forms',
        url: '#',
        icon: 'forms',
        isActive: true,
        items: [
          {
            title: 'basicForm',
            url: '/dashboard/forms/basic',
            icon: 'forms',
            shortcut: ['f', 'f']
          },
          {
            title: 'multiStepForm',
            url: '/dashboard/forms/multi-step',
            icon: 'forms'
          },
          {
            title: 'sheetDialog',
            url: '/dashboard/forms/sheet-form',
            icon: 'forms'
          },
          {
            title: 'advancedPatterns',
            url: '/dashboard/forms/advanced',
            icon: 'forms'
          }
        ]
      },
      {
        title: 'reactQuery',
        url: '/dashboard/react-query',
        icon: 'code',
        isActive: false,
        items: []
      },
      {
        title: 'icons',
        url: '/dashboard/elements/icons',
        icon: 'palette',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: '',
    items: [
      {
        title: 'account',
        url: '#',
        icon: 'account',
        isActive: true,
        items: [
          {
            title: 'profile',
            url: '/dashboard/profile',
            icon: 'profile',
            shortcut: ['m', 'm']
          },
          {
            title: 'notifications',
            url: '/dashboard/notifications',
            icon: 'notification',
            shortcut: ['n', 'n']
          },
          {
            title: 'billing',
            url: '/dashboard/billing',
            icon: 'billing',
            shortcut: ['b', 'b'],
            access: { requireOrg: true }
          },
          {
            title: 'home',
            shortcut: ['l', 'l'],
            url: '/',
            icon: 'login'
          }
        ]
      }
    ]
  }
];
