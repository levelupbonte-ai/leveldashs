import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';

/**
 * The dashboard as an installable app (phone home screen, desktop), in the
 * user's language. Shortcuts: long-press the icon to jump to unread messages,
 * the members, requests or a new publication.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations('metadata.app');
  const icon = (src: string, sizes: string, purpose?: 'maskable') => ({
    src,
    sizes,
    type: 'image/png',
    ...(purpose ? { purpose } : {})
  });
  const shortcutIcons = [icon('/icons/icon-192.png', '192x192')];
  return {
    id: '/dashboard',
    name: 'LevelUp Ecosystem',
    short_name: 'LevelUp',
    description: t('description'),
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0b10',
    theme_color: '#0b0b10',
    icons: [
      icon('/icons/icon-192.png', '192x192'),
      icon('/icons/icon-512.png', '512x512'),
      icon('/icons/maskable-512.png', '512x512', 'maskable')
    ],
    shortcuts: [
      {
        name: t('shortcuts.unread'),
        url: '/dashboard/site/client-portal?folder=unread',
        icons: shortcutIcons
      },
      {
        name: t('shortcuts.members'),
        url: '/dashboard/site/client-portal?tab=customers',
        icons: shortcutIcons
      },
      { name: t('shortcuts.requests'), url: '/dashboard/site/requests', icons: shortcutIcons },
      {
        name: t('shortcuts.publish'),
        url: '/dashboard/site/client-portal?publish=1',
        icons: shortcutIcons
      }
    ]
  };
}
