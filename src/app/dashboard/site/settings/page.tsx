import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { blocksQueryOptions, settingsQueryOptions } from '@/features/site/api/queries';
import { SettingsEditor } from '@/features/site/components/settings-editor';
import { SitePage } from '@/features/site/components/site-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.settings');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.settings');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) => {
        void qc.prefetchQuery(settingsQueryOptions(db, websiteId));
        void qc.prefetchQuery(blocksQueryOptions(db, websiteId));
      }}
    >
      <SettingsEditor />
    </SitePage>
  );
}
