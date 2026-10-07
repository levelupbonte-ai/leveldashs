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
 */
export const navGroups: NavGroup[] = [
  {
    label: 'Mon site',
    items: [
      {
        title: 'Vue d’ensemble',
        url: '/dashboard/site',
        icon: 'world',
        isActive: false,
        shortcut: ['s', 's'],
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'Rendez-vous',
        url: '/dashboard/site/appointments',
        icon: 'calendar',
        isActive: false,
        items: [],
        access: { requireWebsite: true, feature: 'bookings' }
      },
      {
        title: 'File d’attente',
        url: '/dashboard/site/waitlist',
        icon: 'hourglass',
        isActive: false,
        items: [],
        access: { requireWebsite: true, feature: 'waitlist' }
      },
      {
        title: 'Demandes',
        url: '/dashboard/site/requests',
        icon: 'inbox',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'Contenu',
        url: '#',
        icon: 'listDetails',
        isActive: true,
        access: { requireWebsite: true },
        items: [
          {
            title: 'Services',
            url: '/dashboard/site/services',
            icon: 'scissors',
            access: { feature: 'services' }
          },
          {
            title: 'Équipe',
            url: '/dashboard/site/team',
            icon: 'teams',
            access: { feature: 'team' }
          },
          {
            title: 'Galerie',
            url: '/dashboard/site/gallery',
            icon: 'photo',
            access: { feature: 'gallery' }
          },
          {
            title: 'Avis clients',
            url: '/dashboard/site/reviews',
            icon: 'star',
            access: { feature: 'reviews' }
          },
          {
            title: 'Annonces',
            url: '/dashboard/site/announcements',
            icon: 'speakerphone',
            access: { feature: ['announcements', 'promotions', 'blog'] }
          },
          { title: 'FAQ', url: '/dashboard/site/faq', icon: 'help' }
        ]
      },
      {
        title: 'Médiathèque',
        url: '/dashboard/site/media',
        icon: 'photo',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'SEO',
        url: '/dashboard/site/seo',
        icon: 'trendingUp',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'Développeurs',
        url: '/dashboard/site/developers',
        icon: 'code',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
      },
      {
        title: 'Paramètres du site',
        url: '/dashboard/site/settings',
        icon: 'settings',
        isActive: false,
        items: [],
        access: { requireWebsite: true }
      }
    ]
  },
  {
    label: 'Overview',
    items: [
      {
        title: 'Dashboard',
        url: '/dashboard/overview',
        icon: 'dashboard',
        isActive: false,
        shortcut: ['d', 'd'],
        items: []
      },
      {
        title: 'Organisations',
        url: '/dashboard/workspaces',
        icon: 'workspace',
        isActive: false,
        items: []
      },
      {
        title: 'Équipe & accès',
        url: '/dashboard/workspaces/team',
        icon: 'teams',
        isActive: false,
        items: [],
        access: { requireOrg: true }
      },
      {
        title: 'Product',
        url: '/dashboard/product',
        icon: 'product',
        shortcut: ['p', 'p'],
        isActive: false,
        items: []
      },
      {
        title: 'Users',
        url: '/dashboard/users',
        icon: 'teams',
        shortcut: ['u', 'u'],
        isActive: false,
        items: []
      },
      {
        title: 'Kanban',
        url: '/dashboard/kanban',
        icon: 'kanban',
        shortcut: ['k', 'k'],
        isActive: false,
        items: []
      },
      {
        title: 'Chat',
        url: '/dashboard/chat',
        icon: 'chat',
        shortcut: ['c', 'c'],
        isActive: false,
        items: []
      },
      {
        title: 'AI Chat',
        url: '/dashboard/ai-chat',
        icon: 'sparkles',
        shortcut: ['a', 'i'],
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Elements',
    items: [
      {
        title: 'Forms',
        url: '#',
        icon: 'forms',
        isActive: true,
        items: [
          {
            title: 'Basic Form',
            url: '/dashboard/forms/basic',
            icon: 'forms',
            shortcut: ['f', 'f']
          },
          {
            title: 'Multi-Step Form',
            url: '/dashboard/forms/multi-step',
            icon: 'forms'
          },
          {
            title: 'Sheet & Dialog',
            url: '/dashboard/forms/sheet-form',
            icon: 'forms'
          },
          {
            title: 'Advanced Patterns',
            url: '/dashboard/forms/advanced',
            icon: 'forms'
          }
        ]
      },
      {
        title: 'React Query',
        url: '/dashboard/react-query',
        icon: 'code',
        isActive: false,
        items: []
      },
      {
        title: 'Icons',
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
        title: 'LevelUp admin',
        url: '#',
        icon: 'pro',
        isActive: false,
        access: { platformAdmin: true },
        items: [
          {
            title: 'Tous les clients',
            url: '/dashboard/exclusive',
            icon: 'exclusive',
            shortcut: ['e', 'e']
          }
        ]
      },
      {
        title: 'Account',
        url: '#',
        icon: 'account',
        isActive: true,
        items: [
          {
            title: 'Profile',
            url: '/dashboard/profile',
            icon: 'profile',
            shortcut: ['m', 'm']
          },
          {
            title: 'Notifications',
            url: '/dashboard/notifications',
            icon: 'notification',
            shortcut: ['n', 'n']
          },
          {
            title: 'Billing',
            url: '/dashboard/billing',
            icon: 'billing',
            shortcut: ['b', 'b'],
            access: { requireOrg: true }
          },
          {
            title: 'Accueil',
            shortcut: ['l', 'l'],
            url: '/',
            icon: 'login'
          }
        ]
      }
    ]
  }
];
