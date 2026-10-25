import { getTranslations } from 'next-intl/server';
import type { InfobarContent } from '@/components/ui/infobar';

// Help panels of the LevelUp pages, translated on the server (`info.*` messages).
export async function getWorkspacesInfoContent(): Promise<InfobarContent> {
  const t = await getTranslations('info.workspaces');
  return {
    title: t('title'),
    sections: [
      { title: t('principleTitle'), description: t('principle'), links: [] },
      { title: t('switchTitle'), description: t('switch'), links: [] }
    ]
  };
}

export async function getTeamInfoContent(): Promise<InfobarContent> {
  const t = await getTranslations('info.team');
  return {
    title: t('title'),
    sections: [
      { title: t('rolesTitle'), description: t('roles'), links: [] },
      { title: t('addTitle'), description: t('add'), links: [] }
    ]
  };
}

export async function getBillingInfoContent(): Promise<InfobarContent> {
  const t = await getTranslations('info.billing');
  return {
    title: t('title'),
    sections: [
      {
        title: t('subscriptionTitle'),
        description: t('subscription'),
        links: [{ title: t('contact'), url: 'mailto:contact@levelup-ecosystem.com' }]
      }
    ]
  };
}
