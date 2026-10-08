import { integrationQueryOptions } from '@/features/site/api/queries';
import { DevelopersPanel } from '@/features/site/components/developers-panel';
import { SitePage } from '@/features/site/components/site-page';

export const metadata = { title: 'Développeurs' };

export default function Page() {
  return (
    <SitePage
      title='Développeurs'
      description='Connecter le site à LevelUp'
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchQuery(integrationQueryOptions(db, websiteId))
      }
    >
      <DevelopersPanel />
    </SitePage>
  );
}
