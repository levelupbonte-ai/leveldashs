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
 * - `data`: also shown when the website already has rows of that kind
 *   (`site_capabilities().counts`), so whatever a site stores is reachable
 * - `platformAdmin`: LevelUp staff only
 * - `whenLocked`: still shown while the organization must sign its contract or
 *   finish required tasks (everything else is hidden, and the proxy redirects)
 * - `hasContracts`: only once LevelUp sent the organization a contract
 *
 * `label` / `title` are keys of the `nav.groups` / `nav.items` messages (see
 * docs/i18n.md). LevelUp staff work lives in HQ (levelupbonte-ai/leveldashbord),
 * never in this dashboard.
 */
export const navGroups: NavGroup[] = [
  {
    label: 'mySite',
    items: [
      {
        title: 'siteOverview',
        url: '/dashboard/site',
        icon: 'dashboard',
        isActive: false,
        shortcut: ['s', 's'],
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'capabilities',
        url: '/dashboard/site/capabilities',
        icon: 'apps',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'analytics',
        url: '/dashboard/site/analytics',
        icon: 'chartLine',
        isActive: false,
        shortcut: ['a', 'a'],
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'payments',
        url: '/dashboard/site/payments',
        icon: 'creditCard',
        isActive: false,
        shortcut: ['p', 'p'],
        items: [],
        access: { requireWebsite: true, feature: 'payments', data: 'payments' }
      },
      {
        title: 'clientPortal',
        url: '/dashboard/site/client-portal',
        icon: 'lock',
        isActive: false,
        items: [],
        access: { requireWebsite: true, role: 'editor', feature: 'client_portal' }
      },
      {
        title: 'appointments',
        url: '/dashboard/site/appointments',
        icon: 'calendar',
        isActive: false,
        items: [],
        access: { requireWebsite: true, feature: 'bookings', data: 'appointments' }
      },
      {
        title: 'waitlist',
        url: '/dashboard/site/waitlist',
        icon: 'hourglass',
        isActive: false,
        items: [],
        access: { requireWebsite: true, feature: 'waitlist', data: 'waitlist' }
      },
      {
        title: 'projectRequests',
        url: '/dashboard/site/project-requests',
        icon: 'briefcase',
        isActive: false,
        items: [],
        access: { requireWebsite: true, feature: 'project_requests' }
      },
      {
        title: 'requests',
        url: '/dashboard/site/requests',
        icon: 'inbox',
        isActive: false,
        shortcut: ['f', 'f'],
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
            access: { feature: 'services', data: 'services' }
          },
          {
            title: 'team',
            url: '/dashboard/site/team',
            icon: 'teams',
            access: { feature: 'team', data: 'team' }
          },
          {
            title: 'gallery',
            url: '/dashboard/site/gallery',
            icon: 'photo',
            access: { feature: 'gallery', data: 'gallery' }
          },
          {
            title: 'reviews',
            url: '/dashboard/site/reviews',
            icon: 'star',
            access: { feature: 'reviews', data: 'reviews' }
          },
          {
            title: 'announcements',
            url: '/dashboard/site/announcements',
            icon: 'speakerphone',
            access: { feature: ['announcements', 'promotions', 'blog'], data: 'announcements' }
          },
          { title: 'faq', url: '/dashboard/site/faq', icon: 'help' },
          {
            title: 'showcaseTemplates',
            url: '/dashboard/site/templates',
            icon: 'template',
            access: { feature: 'showcase_cms', data: 'templates' }
          },
          {
            title: 'showcaseCaseStudies',
            url: '/dashboard/site/case-studies',
            icon: 'briefcase',
            access: { feature: 'showcase_cms', data: 'case-studies' }
          },
          {
            title: 'showcaseSections',
            url: '/dashboard/site/page-sections',
            icon: 'layoutRows',
            access: { feature: 'showcase_cms', data: 'page-sections' }
          }
        ]
      },
      {
        title: 'forms',
        url: '/dashboard/site/forms',
        icon: 'forms',
        isActive: false,
        items: [],
        // Forms LevelUp hosts for the site (built here, answers in Requests).
        access: { requireWebsite: true }
      },
      {
        title: 'emailCampaigns',
        url: '/dashboard/site/email-campaigns',
        icon: 'mail',
        isActive: false,
        items: [],
        // Contacts are visible to every member (masked for viewers); editors draft,
        // owners and admins send. The database enforces each role.
        access: { requireWebsite: true }
      },
      {
        title: 'assistant',
        url: '/dashboard/site/assistant',
        icon: 'starMark',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
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
        title: 'activity',
        url: '/dashboard/site/activity',
        icon: 'activity',
        isActive: false,
        items: [],
        // Who in the team changed what (owners and admins; the database checks).
        access: { requireWebsite: true, role: 'admin' }
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
        title: 'chat',
        url: '/dashboard/chat',
        icon: 'chat',
        shortcut: ['c', 'c'],
        isActive: false,
        items: [],
        access: { requireOrg: true },
        badge: 'chatUnread'
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
        access: { whenLocked: true },
        items: [
          {
            title: 'contract',
            url: '/dashboard/contract',
            icon: 'contract',
            access: { requireOrg: true, hasContracts: true, whenLocked: true }
          },
          {
            title: 'profile',
            url: '/dashboard/profile',
            icon: 'profile',
            shortcut: ['m', 'm'],
            access: { whenLocked: true }
          },
          {
            title: 'billing',
            url: '/dashboard/billing',
            icon: 'billing',
            shortcut: ['b', 'b'],
            // Owners and admins see the money; members reach their plan from limit notices.
            access: { requireOrg: true, role: 'admin' }
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
