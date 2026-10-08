import { blocksQueryOptions, settingsQueryOptions } from '@/features/site/api/queries';
import { SettingsEditor } from '@/features/site/components/settings-editor';
import { SitePage } from '@/features/site/components/site-page';

export const metadata = { title: 'Paramètres du site' };

export default function Page() {
  return (
    <SitePage
      title='Paramètres du site'
      description='Coordonnées, horaires et textes'
      prefetch={(qc, db, websiteId) => {
        void qc.prefetchQuery(settingsQueryOptions(db, websiteId));
        void qc.prefetchQuery(blocksQueryOptions(db, websiteId));
      }}
    >
      <SettingsEditor />
    </SitePage>
  );
}
